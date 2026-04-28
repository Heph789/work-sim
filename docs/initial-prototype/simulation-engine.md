# Simulation Engine

The runner. Lives in `apps/api/src/engine/`. Owns the per-round loop, prompt
construction, situation-tag selection, the morale → paper-sold formula, and the
runs status state machine.

For why the round shape, see `locked-decisions.md` #1, #4, #7.

---

## Run lifecycle (state machine)

```
                    ┌──────────────┐
                    │   pending    │   created by POST /runs
                    └──────┬───────┘
                           │  runner picks up
                           ▼
                    ┌──────────────┐
                    │   running    │
                    └──┬────────┬──┘
            all rounds │        │  LLM call fails persistently
              finished │        │
                       ▼        ▼
              ┌──────────┐  ┌────────┐
              │completed │  │ failed │
              └──────────┘  └────────┘

                    cancelled — slot reserved, not used in v1
```

Allowed transitions are enforced by the runner, not by the DB (no triggers).
The runner re-reads `runs.status` between rounds; if it becomes anything other
than `running`, the runner exits cleanly (forward-compat for pause/cancel).

---

## Per-round flow

```
for round_index in 1..rounds_total:
  if runs.status != 'running': exit                              ── cooperative checkpoint

  situation_tag = pickTag(seed, round_index)                     ── deterministic

  manager_prompt = buildManagerPrompt({
    profile: managerSnapshot,
    transcript: priorRoundsAsDialogue,
    situation: situation_tag,
    target: targetPaper,
    paperTotal: currentPaperTotal,
    roundsRemaining: roundsTotal - (round_index - 1),
  })
  manager_message = llm.complete(manager_prompt)                 ── LLM call #1

  worker_prompt = buildWorkerPrompt({
    profile: workerSnapshot,
    transcript: priorRoundsAsDialogue,
    situation: situation_tag,
    managerMessage: manager_message,
    selfPerception: lastWorkerSelfPerception ?? "I just started this job.",
  })
  { message, updated_self_perception, morale }
    = llm.completeStructured(worker_prompt, WorkerResponseSchema) ── LLM call #2

  paper_sold = round(workerSnapshot.baseline_output * morale / 50)

  db.transaction:
    insert into rounds (...)
    update runs set rounds_completed = round_index,
                    paper_total = paper_total + paper_sold

set runs.status = 'completed'
```

Two LLM calls per round. Per-round wall time: ~3–6s. A 10-round run is
~30–60s.

---

## Situation tags

Static list, defined in `packages/shared/src/situation-tags.ts`:

```ts
export const SITUATION_TAGS = [
  {
    tag: 'routine_check_in',
    weight: 4,
    description: 'A normal day. The manager is doing a routine 1:1.',
  },
  {
    tag: 'missed_target',
    weight: 2,
    description: 'The team missed an important sales number this week.',
  },
  {
    tag: 'big_client_won',
    weight: 1,
    description: 'A large new client just signed; energy in the office is high.',
  },
  {
    tag: 'tight_deadline',
    weight: 2,
    description: 'There is a delivery deadline at the end of the day with little slack.',
  },
  {
    tag: 'peer_conflict',
    weight: 1,
    description: 'There is friction between the worker and another teammate.',
  },
  {
    tag: 'quiet_week',
    weight: 2,
    description: 'It has been an unusually slow week with little going on.',
  },
  {
    tag: 'customer_complaint',
    weight: 1,
    description: 'A customer escalated a complaint that the worker handled.',
  },
  {
    tag: 'recognition_opportunity',
    weight: 1,
    description: 'The worker did something noticeable that could be acknowledged.',
  },
] as const;
```

### Selection: deterministic from seed

```ts
import seedrandom from 'seedrandom';

export function pickTag(seed: number, roundIndex: number): string {
  const rng = seedrandom(`${seed}:${roundIndex}`);
  const totalWeight = SITUATION_TAGS.reduce((s, t) => s + t.weight, 0);
  let r = rng() * totalWeight;
  for (const t of SITUATION_TAGS) {
    r -= t.weight;
    if (r <= 0) return t.tag;
  }
  return SITUATION_TAGS[SITUATION_TAGS.length - 1].tag;
}
```

Same seed + same round_index always picks the same tag. Reproducible across
replicates. The seed is captured in `config_json.situation_tag_seed` at run
creation time.

---

## Prompt skeletons

Lives in `apps/api/src/engine/prompts.ts`. Both prompts are built as a
`Message[]` with a static `system` prefix (cacheable) and a dynamic `user`
suffix (varies per round).

### Manager turn

**System (static — cacheable across rounds):**

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
- Do NOT explicitly mention the sales target as a number unless it would be in character to do so.
- Stay in character.
```

**User (dynamic):**

```
SITUATION TODAY: {{situation_description}}

YOUR PRIVATE CONTEXT (do not mention these numbers explicitly unless natural):
- Sales target by end of period: {{target_paper}} units of paper.
- Current total sold: {{paper_total}} units.
- Rounds remaining: {{rounds_remaining}}.
- Pace status: {{on_pace_description}}   (e.g., "ahead of pace", "slightly behind", "well behind")

RECENT INTERACTIONS WITH {{worker_name_upper}}:
{{transcript_or_"No prior interactions yet."}}

Now, what do you say to {{worker_name}}?
```

### Worker turn (structured output)

**System (static — cacheable):**

```
You are {{name}}, a {{role_label}} at a paper company.

Your personality:
{{personality}}

What you value at work:
{{values}}

You report to {{manager_name}}, the {{manager_role_label}}.

You will respond with a JSON object containing:
- "message": Your reply to {{manager_name}}, in 1–3 short sentences. Speak naturally. No narration of physical actions. Stay in character.
- "updated_self_perception": A 1–2 sentence update to your private internal monologue based on this exchange. This is your honest read of how things are going for you at work right now. {{manager_name}} cannot see this.
- "morale": An integer 0–100 representing your engagement and motivation right now. 50 is neutral. Below 30 means demoralized. Above 70 means energized. Be honest given your personality, values, and how this exchange landed for you.
```

**User (dynamic):**

```
SITUATION TODAY: {{situation_description}}

YOUR CURRENT INTERNAL STATE (private):
"{{self_perception}}"

RECENT INTERACTIONS WITH {{manager_name_upper}}:
{{transcript_or_"No prior interactions yet."}}

{{manager_name}} just said to you:
"{{manager_message}}"

Respond now.
```

### Initial self-perception

Before round 1, the worker has no `self_perception`. Use a neutral default:

```
"I just started this job. I'm still figuring out what to expect from {{manager_name}} and the work."
```

This default is set by the prompt builder, not stored anywhere; round 1 produces
the first persisted `self_perception`.

### Transcript format

Past rounds are concatenated as plain dialogue, no situation tags or morale
numbers (those are state, not memory):

```
{{manager_name}}: {{manager_message_round_1}}
{{worker_name}}: {{worker_message_round_1}}

{{manager_name}}: {{manager_message_round_2}}
{{worker_name}}: {{worker_message_round_2}}

...
```

When the transcript grows past some token threshold (defer until we hit it —
probably never in v1 with 2 agents), summarize older rounds. For now, include
everything.

---

## Worker response schema (Zod)

```ts
// packages/shared/src/llm-client.ts (or a sibling file)
import { z } from 'zod';

export const WorkerResponseSchema = z.object({
  message: z.string().min(1).max(2000),
  updated_self_perception: z.string().min(1).max(1000),
  morale: z.number().int().min(0).max(100),
});

export type WorkerResponse = z.infer<typeof WorkerResponseSchema>;
```

Used both for OpenAI's strict structured output schema generation AND for
defense-in-depth re-parsing after the response is received.

---

## Paper-sold formula

```ts
export function paperSold(baselineOutput: number, morale: number): number {
  return Math.round(baselineOutput * morale / 50);
}
```

- At morale 50 (neutral), output = baseline.
- At morale 100, output = 2 × baseline.
- At morale 0, output = 0.
- Linear, integer-rounded, no floor/ceiling beyond what 0–100 morale already
  implies.

Lives in `apps/api/src/engine/scoring.ts`. Unit-test with a few cases
(baseline=10, morale ∈ {0, 25, 50, 75, 100}).

---

## Pace description (for manager prompt)

```ts
export function paceDescription(args: {
  paperTotal: number;
  targetPaper: number;
  roundsCompleted: number;
  roundsTotal: number;
}): string {
  const { paperTotal, targetPaper, roundsCompleted, roundsTotal } = args;
  if (roundsCompleted === 0) return 'just starting out';
  const expected = (targetPaper * roundsCompleted) / roundsTotal;
  const ratio = paperTotal / expected;
  if (ratio >= 1.15) return 'ahead of pace';
  if (ratio >= 0.95) return 'on pace';
  if (ratio >= 0.75) return 'slightly behind pace';
  return 'well behind pace';
}
```

Plain English; the LLM does the dramatic interpretation. Lives next to
`paperSold`.

---

## Runner module

```ts
// apps/api/src/engine/runner.ts
export class Runner {
  constructor(
    private llm: LLMClient,
    private db: Database,
  ) {}

  async run(runId: string): Promise<void> {
    const run = await this.db.runs.byId(runId);
    if (!run) throw new Error(`run ${runId} not found`);

    const config = JSON.parse(run.configJson) as RunConfig;
    const manager = config.agents.find(a => a.role_in_sim === 'manager')!;
    const worker  = config.agents.find(a => a.role_in_sim === 'worker')!;

    await this.db.runs.setStatus(runId, 'running');

    let lastSelfPerception: string | null = null;
    let priorRounds: Round[] = [];

    try {
      for (let i = 1; i <= run.roundsTotal; i++) {
        const fresh = await this.db.runs.byId(runId);
        if (fresh.status !== 'running') return;  // cooperative cancel/pause hook

        const tag = pickTag(config.situation_tag_seed, i);

        const managerMsg = await this.llm.complete(
          buildManagerPrompt({
            manager, worker, priorRounds, situationTag: tag,
            target: run.targetPaper,
            paperTotal: fresh.paperTotal,
            roundsCompleted: fresh.roundsCompleted,
            roundsTotal: fresh.roundsTotal,
          }),
          { model: config.model, temperature: config.temperature },
        );

        const workerRes = await this.llm.completeStructured(
          buildWorkerPrompt({
            manager, worker, priorRounds, situationTag: tag,
            managerMessage: managerMsg,
            selfPerception: lastSelfPerception,
          }),
          WorkerResponseSchema,
          'WorkerResponse',
          { model: config.model, temperature: config.temperature },
        );

        const paperSoldThisRound = paperSold(worker.baseline_output, workerRes.morale);

        await this.db.transaction(async (tx) => {
          await tx.rounds.insert({
            id: uuid(),
            runId,
            roundIndex: i,
            situationTag: tag,
            managerMessage: managerMsg,
            workerMessage: workerRes.message,
            workerSelfPerception: workerRes.updated_self_perception,
            morale: workerRes.morale,
            paperSold: paperSoldThisRound,
            createdAt: Date.now(),
          });
          await tx.runs.bumpProgress(runId, i, paperSoldThisRound);
        });

        lastSelfPerception = workerRes.updated_self_perception;
        priorRounds.push({ /* ... */ });
      }

      await this.db.runs.setStatus(runId, 'completed');
    } catch (err) {
      await this.db.runs.setFailed(runId, {
        errorMessage: err instanceof Error ? err.message : String(err),
        failedAtRound: priorRounds.length + 1,
      });
    }
  }
}
```

### How it gets started

```ts
// apps/api/src/routes/runs.ts (POST /runs)
const id = uuid();
await db.runs.insert({ id, status: 'pending', /* ... */ });
reply.send({ id });

// Fire-and-forget. Errors are caught inside the runner and persisted.
setImmediate(() => runner.run(id).catch(console.error));
```

### Crash recovery (forward-compat, not built v1)

On boot, query `SELECT id FROM runs WHERE status = 'running'` and re-run them.
The state-machine + per-round persistence make this safe — the runner picks up
at `rounds_completed + 1`. Not wired up in v1; documented here so we don't
forget the schema already supports it.

---

## What lives where

```
apps/api/src/engine/
├── runner.ts             # Runner class
├── prompts.ts            # buildManagerPrompt, buildWorkerPrompt
├── scoring.ts            # paperSold, paceDescription
└── transcript.ts         # formatTranscript(priorRounds): string

packages/shared/src/
├── situation-tags.ts     # SITUATION_TAGS, pickTag
└── llm-client.ts         # WorkerResponseSchema lives here next to the interface
```
