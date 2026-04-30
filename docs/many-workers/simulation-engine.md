# Simulation Engine — Many Workers

The runner. Lives in `apps/api/src/engine/`. Owns the per-round loop, prompt
construction, situation-tag selection, peer pair sampling, the morale → paper-
sold formula, and the run status state machine.

For why this shape, see `design.md` (especially §2 Round-as-day, §4 Peer phase,
§5 Strict serial, §13 Engine flow).

---

## Run lifecycle (state machine)

Unchanged from the prototype:

```
pending → running → (completed | failed | cancelled)
```

Allowed transitions are enforced by the runner; the runner re-reads
`run.status` between rounds and exits cleanly if it becomes anything other
than `running`.

---

## Per-round flow

Each round (`round_index`) executes three steps in order: **manager phase,
peer phase, settle.** Within each phase, work is strictly serial — every
interaction immediately updates participants' running state and subsequent
prompts see those updates.

```
for round_index in 1..rounds_total:
  if run.status != 'running': exit                       ── cooperative checkpoint

  # 0. Pick situation tag, insert round row
  tag = pickTag(seed, round_index)
  round_id = insert into round (run_id, round_index, situation_tag, created_at)

  order = 0

  # 1. Manager phase — N 1:1s in deterministic worker order
  worker_order = seededShuffle(workers, seed=(seed, round_index, 'manager'))
  for worker in worker_order:
    manager_msg = llm.complete(buildManagerPrompt({
      manager, worker, situation: tag,
      target, paperTotal, roundsRemaining, roundsCompleted, roundsTotal,
      workerPaperTotal, workerExpectedShare, workerDeltaSigned,
      transcript: priorManagerWorker1on1s(worker),
    }))
    worker_turn = llm.completeStructured(buildWorker1on1Prompt({
      worker, manager, situation: tag,
      selfPerception: workerState[worker].selfPerception,
      todaySoFar: roundInteractionsForThisAvatarSoFar(worker),
      managerHistory: priorManagerWorker1on1s(worker),
      managerMessage: manager_msg,
    }), AvatarTurnSchema)

    insert into interaction {
      run_id, round_id, round_index, order_in_round: order++,
      situation_tag: tag,
      initiator_avatar_id: manager.id, responder_avatar_id: worker.id,
      initiator_message: manager_msg,
      responder_message: worker_turn.message,
      initiator_morale: NULL, initiator_morale_rationale: NULL,
      initiator_self_perception: NULL,
      responder_morale: worker_turn.morale,
      responder_morale_rationale: worker_turn.morale_rationale,
      responder_self_perception: worker_turn.updated_self_perception,
    }
    workerState[worker].selfPerception = worker_turn.updated_self_perception
    workerState[worker].morale         = worker_turn.morale
    workerState[worker].moraleRationale = worker_turn.morale_rationale

  # 2. Peer phase — K = N pair conversations
  pairs = samplePairs(workers, K=workers.length, seed=(seed, round_index, 'peer'))
  for (a, b) in pairs:
    initiator, responder = orientPair(a, b, seed=(seed, round_index, 'peer', order))

    a_turn = llm.completeStructured(buildPeerInitiatorPrompt({
      self: initiator, partner: responder, situation: tag,
      selfPerception: workerState[initiator].selfPerception,
      todaySoFar: roundInteractionsForThisAvatarSoFar(initiator),
      pairHistory: priorPeerInteractionsBetween(a, b),
    }), AvatarTurnSchema)

    b_turn = llm.completeStructured(buildPeerResponderPrompt({
      self: responder, partner: initiator, situation: tag,
      selfPerception: workerState[responder].selfPerception,
      todaySoFar: roundInteractionsForThisAvatarSoFar(responder),
      pairHistory: priorPeerInteractionsBetween(a, b),
      initiatorMessage: a_turn.message,
    }), AvatarTurnSchema)

    insert into interaction {
      ... order_in_round: order++,
      initiator_avatar_id: initiator.id, responder_avatar_id: responder.id,
      initiator_message: a_turn.message,
      responder_message: b_turn.message,
      initiator_morale: a_turn.morale,
      initiator_morale_rationale: a_turn.morale_rationale,
      initiator_self_perception: a_turn.updated_self_perception,
      responder_morale: b_turn.morale,
      responder_morale_rationale: b_turn.morale_rationale,
      responder_self_perception: b_turn.updated_self_perception,
    }
    workerState[initiator].selfPerception = a_turn.updated_self_perception
    workerState[initiator].morale         = a_turn.morale
    workerState[initiator].moraleRationale = a_turn.morale_rationale
    workerState[responder].selfPerception = b_turn.updated_self_perception
    workerState[responder].morale         = b_turn.morale
    workerState[responder].moraleRationale = b_turn.morale_rationale

  # 3. Settle — write per-avatar end-of-round state
  for worker in workers:
    paper_sold = round(worker.baseline_output * workerState[worker].morale / 50)
    insert into round_avatar {
      run_id, round_id, round_index, avatar_id: worker.id,
      morale: workerState[worker].morale,
      morale_rationale: workerState[worker].moraleRationale,
      self_perception: workerState[worker].selfPerception,
      paper_sold,
    }
  insert into round_avatar {
    run_id, round_id, round_index, avatar_id: manager.id,
    morale: NULL, morale_rationale: NULL, self_perception: NULL,
    paper_sold: NULL,
  }
  update run set
    rounds_completed = round_index,
    paper_total = paper_total + sum(paper_sold for workers)

set run.status = 'completed'
```

LLM call count per round: **N (manager 1:1s) + 2K (peer convos) = 3N**, where
each manager 1:1 is one `complete` + one `completeStructured` and each peer
convo is two `completeStructured` calls. For N=4, that's 12 calls per round; a
10-round run is ~120 LLM calls.

---

## Situation tags

Same static list as the prototype (`packages/shared/src/situation-tags.ts`).
Same `pickTag(seed, round_index)` helper. One tag per round, shared across all
interactions in that round (denormalized onto each `interaction` row).

---

## Peer pair sampling

```ts
// packages/shared/src/pair-sampling.ts
import seedrandom from 'seedrandom';

export function samplePairs(
  workers: Avatar[],
  K: number,
  seed: string,
): [Avatar, Avatar][] {
  const rng = seedrandom(seed);
  const n = workers.length;
  if (n < 2) return [];

  // All unique unordered pairs.
  const allPairs: [Avatar, Avatar][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      allPairs.push([workers[i], workers[j]]);
    }
  }

  // Sample K pairs without replacement; if K > allPairs.length,
  // sample all unique pairs first, then fill the rest with replacement.
  const result: [Avatar, Avatar][] = [];
  const remaining = [...allPairs];
  while (result.length < K && remaining.length > 0) {
    const idx = Math.floor(rng() * remaining.length);
    result.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  while (result.length < K) {
    const idx = Math.floor(rng() * allPairs.length);
    result.push(allPairs[idx]);
  }
  return result;
}

export function orientPair(
  a: Avatar,
  b: Avatar,
  seed: string,
): [Avatar, Avatar] {
  const rng = seedrandom(seed);
  return rng() < 0.5 ? [a, b] : [b, a];
}
```

Properties:
- Deterministic from the seed → reproducible.
- No self-pairs (loops skip `i==j`).
- No within-round duplicates until the unique-pair space is exhausted.
- N=1 → returns `[]`, peer phase becomes a no-op.

---

## Prompt skeletons

Lives in `apps/api/src/engine/prompts.ts`. Same Message[]-with-static-system /
dynamic-user shape as the prototype. Three builders:

### `buildManagerPrompt({...})` — manager 1:1, free-text completion

**System (static — cacheable):**

```
You are {{name}}, the {{role_label}} at a paper company.

Your personality:
{{personality}}

What you value at work:
{{values}}

You are speaking with your direct report, {{worker_name}}, who works as a {{worker_role_label}}.

Rules of engagement:
- Speak naturally, in 1–3 short sentences.
- Do NOT narrate your own actions ("I lean back in my chair…"). Just say what you say.
- Do NOT reference round numbers, simulations, or any meta-commentary.
- Do NOT explicitly mention numerical sales targets unless it would be in character to do so.
- Stay in character.
```

**User (dynamic):**

```
SITUATION TODAY: {{situation_description}}

YOUR PRIVATE CONTEXT:
- Sales target by end of period: {{target_paper}} units total.
- Team total sold: {{paper_total}} units.
- Expected team total by now: {{team_expected}} units.
- Team is {{team_delta_abs}} units {{above|below}} expected.
- Rounds remaining: {{rounds_remaining}}.

ABOUT {{worker_name_upper}}:
- Their cumulative output this run: {{worker_paper_total}} units.
- Their expected share by now: {{worker_expected_share}} units.
    ( = target_paper / num_workers × rounds_completed / rounds_total )
- They are {{worker_delta_abs}} units {{above|below}} their expected share.

RECENT INTERACTIONS WITH {{worker_name_upper}}:
{{transcript_or_"No prior interactions yet."}}

Now, what do you say to {{worker_name}}?
```

The transcript here is **manager↔worker only** for that worker — no peer
interactions, no other workers' 1:1s. Per design.md §7, the manager prompt
must never include any worker's morale, morale_rationale, self_perception, or
baseline_output.

### `buildWorker1on1Prompt({...})` — worker side of manager 1:1, structured

**System (static — cacheable):**

```
You are {{name}}, a {{role_label}} at a paper company.

Your personality:
{{personality}}

What you value at work:
{{values}}

You report to {{manager_name}}, the {{manager_role_label}}. You also work
alongside other employees on your team.

You will respond with a JSON object containing:
- "message": Your reply to {{manager_name}}, in 1–3 short sentences. Speak naturally. No narration of physical actions. Stay in character.
- "updated_self_perception": A 1–2 sentence update to your private internal monologue based on this exchange. Mention specific people by name where relevant. {{manager_name}} cannot see this.
- "morale": An integer 0–100 representing your engagement and motivation right now. 50 is neutral. Below 30 means demoralized. Above 70 means energized.
- "morale_rationale": One short sentence explaining why this morale, given the day.
```

**User (dynamic):**

```
SITUATION TODAY: {{situation_description}}

YOUR CURRENT INTERNAL STATE (private):
"{{self_perception_or_initial_default}}"

YOUR DAY SO FAR:
{{transcript_of_today_for_this_avatar_or_"You haven't done much yet today."}}

RECENT INTERACTIONS WITH {{manager_name_upper}} (across this run):
{{manager_history_or_"No prior interactions yet."}}

{{manager_name}} just said to you:
"{{manager_message}}"

Respond now.
```

### `buildPeerInitiatorPrompt({...})` — peer initiator, structured

**System (static):**

```
You are {{name}}, a {{role_label}} at a paper company.

Your personality:
{{personality}}

What you value at work:
{{values}}

You work alongside several other employees. You are about to have a brief
hallway/break-room exchange with your coworker {{partner_name}}, who works as
a {{partner_role_label}}.

You will respond with a JSON object containing:
- "message": What you say to {{partner_name}}, in 1–3 short sentences. Speak naturally. No narration of physical actions. Stay in character.
- "updated_self_perception": A 1–2 sentence update to your private internal monologue based on this exchange. Mention specific people by name where relevant. {{partner_name}} cannot see this.
- "morale": An integer 0–100 representing your engagement and motivation right now.
- "morale_rationale": One short sentence explaining why this morale, given the day.
```

**User (dynamic):**

```
SITUATION TODAY: {{situation_description}}

YOUR CURRENT INTERNAL STATE (private):
"{{self_perception}}"

YOUR DAY SO FAR:
{{transcript_of_today_for_this_avatar_or_"You haven't done much yet today."}}

PRIOR HISTORY WITH {{partner_name_upper}} (across this run):
{{pair_history_or_"You haven't spoken with them before in this run."}}

You step into the hallway and see {{partner_name}}. What do you say?
```

### `buildPeerResponderPrompt({...})` — peer responder, structured

System: identical to `buildPeerInitiatorPrompt`'s system, but framed
"You are about to **respond** to {{partner_name}}, your coworker…"

**User (dynamic):**

```
SITUATION TODAY: {{situation_description}}

YOUR CURRENT INTERNAL STATE (private):
"{{self_perception}}"

YOUR DAY SO FAR:
{{transcript_of_today_for_this_avatar_or_"You haven't done much yet today."}}

PRIOR HISTORY WITH {{partner_name_upper}} (across this run):
{{pair_history_or_"You haven't spoken with them before in this run."}}

{{partner_name}} just said to you:
"{{initiator_message}}"

Respond now.
```

### Initial self-perception

Before round 1, every worker's `self_perception` is the same neutral default:

```
"I just started this job. I'm still figuring out what to expect from my manager and coworkers."
```

Round 1 produces the first persisted self_perception per avatar (via the first
interaction they participate in).

### Transcript formats

- **`transcript_of_today_for_this_avatar`**: Plain dialogue lines from this
  round's already-resolved interactions where this avatar participated, in
  `order_in_round` ascending. No situation tags, morale numbers, or rationales
  — those are state, not memory.
- **`manager_history`** / **`pair_history`**: Plain dialogue lines from prior
  rounds' interactions of the right scope (manager↔W only / A↔B only).
- When the transcript grows past a token threshold, summarize older rounds
  (defer until we hit it).

---

## Unified turn schema (Zod)

```ts
// packages/shared/src/llm-client.ts
import { z } from 'zod';

export const AvatarTurnSchema = z.object({
  message: z.string().min(1).max(2000),
  updated_self_perception: z.string().min(1).max(1000),
  morale: z.number().int().min(0).max(100),
  morale_rationale: z.string().min(1).max(500),
});

export type AvatarTurn = z.infer<typeof AvatarTurnSchema>;
```

Used by all three structured calls (worker 1:1, peer initiator, peer responder).
Replaces the prototype's `WorkerResponseSchema`.

---

## Paper-sold formula

Unchanged from prototype:

```ts
export function paperSold(baselineOutput: number, morale: number): number {
  return Math.round(baselineOutput * morale / 50);
}
```

Applied per worker, once per round, against the worker's **end-of-round
morale** (= the last morale value they emitted that round).

---

## Per-worker stats helper

```ts
// apps/api/src/engine/scoring.ts
export function workerExpectedShare(args: {
  targetPaper: number;
  numWorkers: number;
  roundsCompleted: number;
  roundsTotal: number;
}): number {
  return Math.round(
    (args.targetPaper / args.numWorkers) *
    (args.roundsCompleted / args.roundsTotal)
  );
}

export function teamExpected(args: {
  targetPaper: number;
  roundsCompleted: number;
  roundsTotal: number;
}): number {
  return Math.round(
    args.targetPaper * args.roundsCompleted / args.roundsTotal
  );
}

export function signedDelta(actual: number, expected: number): {
  abs: number;
  direction: 'above' | 'below';
} {
  const d = actual - expected;
  return { abs: Math.abs(d), direction: d >= 0 ? 'above' : 'below' };
}
```

The prototype's `paceDescription` becomes unused (manager prompt now uses raw
deltas, not categorical descriptions) and can be removed.

---

## Runner module sketch

```ts
// apps/api/src/engine/runner.ts
export class Runner {
  constructor(private llm: LLMClient, private db: Database) {}

  async run(runId: string): Promise<void> {
    const run     = await this.db.runs.byId(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    const config  = JSON.parse(run.configJson) as RunConfig;
    const avatars = await this.db.avatars.byRunId(runId);
    const manager = avatars.find(a => a.roleInSim === 'manager')!;
    const workers = avatars.filter(a => a.roleInSim === 'worker');

    await this.db.runs.setStatus(runId, 'running');

    // Running per-worker state, kept in memory across the loop.
    const workerState = new Map(workers.map(w => [w.id, {
      selfPerception: INITIAL_SELF_PERCEPTION,
      morale: 50,                  // neutral default; not persisted until first interaction
      moraleRationale: '',
    }]));

    try {
      for (let i = 1; i <= run.roundsTotal; i++) {
        const fresh = await this.db.runs.byId(runId);
        if (fresh.status !== 'running') return;

        await this.runRound(run, config, manager, workers, workerState, i);
      }
      await this.db.runs.setStatus(runId, 'completed');
    } catch (err) {
      await this.db.runs.setFailed(runId, {
        errorMessage: err instanceof Error ? err.message : String(err),
        failedAtRound: /* current i */,
      });
    }
  }

  private async runRound(...): Promise<void> {
    // 1. pickTag, insert round
    // 2. manager phase
    // 3. peer phase
    // 4. settle (round_avatar rows + run progress bump)
    // — see pseudocode at top of this file.
  }
}
```

---

## What lives where

```
apps/api/src/engine/
├── runner.ts             # Runner class, runRound, runManagerPhase, runPeerPhase, settle
├── prompts.ts            # buildManagerPrompt, buildWorker1on1Prompt,
│                         # buildPeerInitiatorPrompt, buildPeerResponderPrompt
├── scoring.ts            # paperSold, teamExpected, workerExpectedShare, signedDelta
└── transcript.ts         # formatTranscript, formatPairHistory, formatTodaySoFar

packages/shared/src/
├── situation-tags.ts     # SITUATION_TAGS, pickTag (unchanged)
├── pair-sampling.ts      # samplePairs, orientPair
└── llm-client.ts         # AvatarTurnSchema lives here next to the LLMClient interface
```
