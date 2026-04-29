# Many-workers — Design

Locked decisions from the design grilling on top of `idea-dump.md`. Companion
to `docs/initial-prototype/` — this iteration *replaces* the single-worker
assumption with a 1-manager + N-workers model and adds peer interactions.

This is greenfield over the existing prototype: we rename tables and reshape
the data model where it makes sense; no backwards-compatibility constraints.

---

## Terminology

- **Avatar** — a simulated persona (manager or worker). Replaces the prior
  "agent" terminology everywhere: code, types, tables, prompts, docs.
- **Run** — a simulation. Has one manager, N≥1 workers, T rounds.
- **Round** — a "day." One row in `round`. Each round produces a sequence of
  interactions and a per-worker output number.
- **Interaction** — a single exchange between two avatars (manager-worker 1:1
  or worker-worker peer convo). One row in `interaction`.

Database table names are singular: `run`, `round`, `avatar`, `interaction`,
`round_avatar`.

---

## 1. Org shape: 1 manager + N workers, single team

Exactly one manager per run. N≥1 workers, all reporting to that manager. No
multi-manager runs, no org tree. N=1 is supported as a degenerate case so the
single-worker prototype workflow still works (peer phase is empty).

**Why:** Scoped to validate multi-worker dynamics in this iteration. Cross-team
dynamics, skip-levels, and manager-of-managers are deferred. Schema keeps a
`manager_id`-style FK on workers/interactions so adding more managers later is
additive.

---

## 2. Round = "day" with two phases

Each round is a day. Within a day, the engine runs two phases in fixed order:

1. **Manager phase** — manager has a 1:1 with every worker.
2. **Peer phase** — K = N peer pair conversations.

"Phase" is engine code structure plus an `order_in_round` column on each
interaction; it is **not** a separate table or column in the schema. (See
schema below — manager-vs-peer is derived from participants' `role_in_sim`.)

**Why:** "Round = day" is the unit users see (one tick of the simulation).
Phase-grouping keeps the engine compositional (`runManagerPhase()` then
`runPeerPhase()`) and gives the dashboard a clean per-round-per-worker view.

---

## 3. Manager phase: every worker, every round

The manager has a 1:1 with each worker every round. N exchanges per round, in
a deterministic order seeded from `(situation_tag_seed, round_index)`.

**Why:** Cleanest mapping from the existing prototype. Equal footing for the
dashboard story ("compare workers' morale curves"). Manager-attention scarcity
is interesting but a v2 lever; "manager skips a worker" can come later as a
deterministic-subset variant without schema changes.

---

## 4. Peer phase: K = N pair conversations per round

Each round, the engine deterministically samples K = N peer pairs from
`(situation_tag_seed, round_index)`. For each pair:

- One-shot exchange (initiator speaks → responder responds; no multi-turn).
- Initiator is chosen by a deterministic coin per pair.
- Both participants emit `message`, `updated_self_perception`, `morale`,
  `morale_rationale`.

Pair-sampling rules:
- No self-pair.
- No duplicate unordered pair within the same round, *unless* the unique-pair
  space is smaller than K (e.g. N=2 has only one unique pair; K=2 then allows
  the same pair twice).
- Same pair can recur across different rounds freely.
- N=1 → peer phase is empty.

**Why:** K=N keeps each worker in ~2 peer interactions per round on average —
enough to surface peer dynamics without exploding cost. Reputation-weighted
sampling is deferred; uniform random keeps the experiment legible.

---

## 5. Within-round state: strict serial

Every interaction immediately updates each participant's `self_perception` and
`morale`. Subsequent interactions in the same round see the updated state and
the new transcript line.

Concretely: after worker W's morning 1:1 with the manager, W's later peer
prompts include the 1:1 transcript and reflect W's updated self-perception.

**Why:** The whole reason peer interactions matter is causal chaining with
the manager 1:1. Batching loses the dynamic. Yes, it forecloses LLM
parallelization within a round; that's an acceptable cost for prototype scale.

---

## 6. Self-perception: singleton with prompt nudge

Each avatar has a single `self_perception` string, updated by every interaction
they participate in. The prompts nudge the LLM to mention specific people by
name so the singleton stays relationally informative.

Per-relationship state matrices are deferred — interesting at scale, premature
now. The full transcript lives in `interaction` rows, so we lose no relational
data.

---

## 7. Manager information asymmetry

The manager prompt **never** sees:
- Worker morale, morale rationale, or self_perception.
- `baseline_output` (engine implementation detail).

The manager prompt **does** see:
- Team target, team total, team's expected total by now, signed delta, rounds
  remaining.
- Per-worker objective output: cumulative output, expected share by now,
  signed delta from that share.
- Prior 1:1 transcript with the worker being addressed (and only that
  worker — no peer convos leak through).

**Why:** The interesting dynamic is managers having to *infer* internal state
from observable behavior. Leaking morale collapses that asymmetry. Stated by
user: "the manager shouldn't have morale information about the worker."

---

## 8. Prompt context scoping

| Prompt                        | Sees                                                                                                 |
|-------------------------------|------------------------------------------------------------------------------------------------------|
| Manager 1:1 with worker W     | Manager profile + situation tag + private context (§7) + prior **manager↔W** interactions only.      |
| Peer interaction A→B (initiator A) | A's profile + situation + A's recent interactions this run (any partner) + prior **A↔B** history. |
| Peer interaction A→B (responder B) | B's profile + situation + B's recent interactions this run (any partner) + prior **A↔B** history + initiator's message. |

`self_perception` is private to each avatar — never appears in any other
avatar's prompt.

---

## 9. Situation tag: per-round, shared

One `situation_tag` per round (existing mechanic), shared by all interactions
in that round. Denormalized onto `interaction` rows for filter convenience.
No peer-specific tags introduced.

---

## 10. Paper-sold: end-of-round morale per worker

For each worker, the *last* morale value they emitted during the round drives
`paper_sold = round(baseline_output * morale / 50)`. One paper_sold value per
worker per round, stored on `round_avatar`.

If a worker had no peer interactions that round, their final morale is the
morale from their manager 1:1.

`run.paper_total` is the sum across `round_avatar.paper_sold` for all rounds.

---

## 11. Schema

### Existing tables — renamed

`runs` → `run`, `rounds` → `round`. Plural names are gone; the prototype data
gets dropped (greenfield).

### `run`

```
run
├── id                 text PK
├── created_at         integer
├── status             text   ('pending' | 'running' | 'completed' | 'failed' | 'cancelled')
├── rounds_total       integer
├── rounds_completed   integer
├── target_paper       integer
├── paper_total        integer       (sum of round_avatar.paper_sold)
├── experiment_id      text NULL
├── config_json        text          (full input snapshot for reproducibility)
├── error_message      text NULL
├── failed_at_round    integer NULL
```

`config_json` continues to hold a full snapshot of avatar profiles so
experiments stay reproducible even if the `avatar` table is mutated/inspected.

### `avatar` — new (was JSON-in-config-only)

```
avatar
├── id                text PK
├── run_id            text FK → run.id
├── role_in_sim       text   ('manager' | 'worker')
├── name              text
├── role_label        text
├── personality       text
├── values            text
├── baseline_output   integer
```

Snapshot still in `run.config_json`; this table is the queryable canonical for
FKs.

### `round` — slimmed

```
round
├── id              text PK
├── run_id          text FK → run.id
├── round_index     integer        (1-based, UNIQUE per run)
├── situation_tag   text
├── created_at      integer
```

Per-worker fields move to `round_avatar`.

### `round_avatar` — new

One row per (round, avatar). Captures end-of-round state per avatar.

```
round_avatar
├── id                  text PK
├── run_id              text FK → run.id
├── round_id            text FK → round.id
├── round_index         integer        (denorm)
├── avatar_id           text FK → avatar.id
├── morale              integer NULL    (NULL for manager in v1)
├── morale_rationale    text    NULL
├── self_perception     text    NULL
├── paper_sold          integer NULL    (NULL for manager — managers don't sell paper)
├── created_at          integer

UNIQUE (run_id, round_id, avatar_id)
```

### `interaction` — new

One row per LLM exchange.

```
interaction
├── id                          text PK
├── run_id                      text FK → run.id
├── round_id                    text FK → round.id
├── round_index                 integer        (denorm sort)
├── order_in_round              integer        (0-based; UNIQUE with round_id)
├── situation_tag               text           (denorm)
├── initiator_avatar_id         text FK → avatar.id
├── responder_avatar_id         text FK → avatar.id
├── initiator_message           text
├── responder_message           text
├── initiator_morale            integer NULL   (NULL when initiator is manager)
├── initiator_morale_rationale  text    NULL
├── initiator_self_perception   text    NULL
├── responder_morale            integer
├── responder_morale_rationale  text
├── responder_self_perception   text
├── created_at                  integer
```

Indexes:
- `(run_id, round_index, order_in_round)` UNIQUE — render order.
- `(run_id, initiator_avatar_id)`, `(run_id, responder_avatar_id)` — per-avatar feeds.
- `(run_id, initiator_avatar_id, responder_avatar_id)` — pair filter.

Manager-vs-peer is derived from participants' `role_in_sim`; no `phase`
column.

---

## 12. Prompts

### 12.1 Manager 1:1 — system (static)

Same as existing prototype, with the worker block parameterized by the
specific worker being addressed.

### 12.2 Manager 1:1 — user (dynamic)

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
    ( = target_paper / num_workers × rounds_completed / rounds_total)
- They are {{worker_delta_abs}} units {{above|below}} their expected share.

RECENT INTERACTIONS WITH {{worker_name_upper}}:
{{transcript_of_manager_W_1on1s_or_"No prior interactions yet."}}

Now, what do you say to {{worker_name}}?
```

The existing `paceDescription` helper becomes unused and can be removed.

### 12.3 Peer interaction — initiator system (static)

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
- "morale": An integer 0–100 representing your engagement and motivation right now. Be honest given your personality, values, and the day so far.
- "morale_rationale": One short sentence explaining why this morale, given the day.
```

### 12.4 Peer interaction — initiator user (dynamic)

```
SITUATION TODAY: {{situation_description}}

YOUR CURRENT INTERNAL STATE (private):
"{{self_perception}}"

YOUR DAY SO FAR:
{{transcript_of_A's_interactions_today_or_"You haven't done much yet today."}}

PRIOR HISTORY WITH {{partner_name_upper}} (across this run):
{{A_B_history_or_"You haven't spoken with them before in this run."}}

You step into the hallway and see {{partner_name}}. What do you say?
```

### 12.5 Peer interaction — responder

System: identical to 12.3 but framed "You are about to respond to
{{partner_name}}…" User: same as 12.4 but ends with the initiator's message
quoted, and prompts "Respond now."

### 12.6 Unified turn schema

The Zod schema (was `WorkerResponseSchema`) is renamed `AvatarTurnSchema` and
used for every structured emission (worker 1:1 response and both sides of
peer convos):

```ts
export const AvatarTurnSchema = z.object({
  message: z.string().min(1).max(2000),
  updated_self_perception: z.string().min(1).max(1000),
  morale: z.number().int().min(0).max(100),
  morale_rationale: z.string().min(1).max(500),
});
```

---

## 13. Engine flow

```
for round_index in 1..rounds_total:
  if run.status != 'running': exit                       ── cooperative checkpoint
  tag = pickTag(seed, round_index)
  insert round row

  # Manager phase — N 1:1s, deterministic worker order
  for worker in workers (in seeded order):
    msg = manager_complete(...)
    res = worker_completeStructured(... AvatarTurnSchema)
    insert interaction row (initiator=manager, responder=worker, manager-side morale NULL)
    update worker's running self_perception + morale

  # Peer phase — K = N pairs, deterministic
  pairs = samplePairs(seed, round_index, K=workers.length)
  for (a, b) in pairs (in sampled order):
    initiator, responder = orientPair(seed, round_index, a, b)
    msg_a = initiator_completeStructured(... AvatarTurnSchema)
    msg_b = responder_completeStructured(... AvatarTurnSchema)   # sees initiator's message
    insert interaction row (both morale fields populated)
    update both participants' running self_perception + morale

  # Settle — write end-of-round per-avatar state
  for each worker:
    paper_sold = round(baseline * lastMorale / 50)
    insert round_avatar row
  insert round_avatar row for manager (morale/paper_sold NULL)

  update run.rounds_completed, run.paper_total

set run.status = 'completed'
```

All interaction rows for a round get sequential `order_in_round` values
(0..N+K-1).

---

## 14. Frontend views

### 14.1 Dashboard view (primary)

Per-run landing. Shows:
- Top: run header — target, team total, team delta, round_index/total.
- Per-avatar table: name, role, current morale, cumulative paper_sold,
  last-round paper_sold, sparkline of morale-over-rounds.
- Live-polled (existing prototype's polling cadence).

### 14.2 Avatar view (drilldown)

Click an avatar from the dashboard. Shows:
- That avatar's interactions in `(round_index, order_in_round)` order
  (initiator-side + responder-side combined).
- Filter: by round, by partner.
- Per-round morale chart for this avatar.

### 14.3 Pair filter (no new page)

Clicking a partner name in the avatar view filters interactions to just that
pair via a query string on the avatar view. No separate route.

---

## 15. Deferred (out of scope this iteration)

- Multi-manager / org tree.
- Reputation matrix between avatars (pair sampling stays uniform).
- Manager performance reports as separate LLM artifacts (replaced by
  per-worker stats injected into 1:1 prompts).
- Manager state — `manager.morale` stays NULL.
- LLM-driven scheduling (engine is fully deterministic).
- Pause/resume, crash recovery (already deferred in prototype).
- Per-relationship `self_perception` matrix (singleton with prompt nudge).
- Manager-attention scarcity (variant subset for manager phase).

Each of these is additive on top of the schema and engine shape above.
