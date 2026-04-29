# Many-Workers Backend Scaffold — Design

## Overview

Structural scaffold for the work-sim backend at the **many-workers** iteration
(`docs/many-workers/`). Replaces the prototype's 1-manager-1-worker shape with
1 manager + N workers, peer interactions, and a queryable interaction table.

Greenfield over the prototype — names change (`agent` → `avatar`, plural →
singular tables) and the data model reshapes. No backwards-compatibility shims.

The backend is a single Node + TypeScript + Fastify process that:

1. Accepts `POST /runs` to start an N-worker paper-company simulation.
2. Persists run state to a local SQLite file via Drizzle ORM. Five tables:
   `run`, `avatar`, `round`, `round_avatar`, `interaction`.
3. Drives an in-process simulation engine that, for each round, runs a
   **manager phase** (N 1:1s) followed by a **peer phase** (K=N pair convos),
   then **settles** by writing per-avatar end-of-round state.
4. Serves polling reads — `GET /runs`, `GET /runs/:id` (dashboard view),
   `GET /runs/:id/avatars/:avatarId` (drilldown view).

The scaffold is shape-only: types, signatures, constants, TODO bodies.

## Motivation

Per `docs/many-workers/design.md`, the new hypothesis is whether peer
interactions between workers measurably shape team morale and output beyond
what the manager alone produces. Architecture choices stay close to the
prototype — same in-process runner, same SQLite + Drizzle, same `LLMClient`
abstraction — only the per-round mechanics expand.

Key invariants the scaffold encodes:

- **Manager information asymmetry.** The manager prompt **never** sees worker
  morale, morale rationale, self_perception, or baseline_output. Only objective
  output stats (cumulative paper, expected share, signed delta) and prior
  manager↔worker transcript with the worker being addressed.
- **Strict serial within a round.** Every interaction immediately updates
  participants' running self_perception + morale; subsequent prompts within
  the round see the updates.
- **Append-only interactions.** One `interaction` row per LLM exchange, with
  both sides' messages, morale, and self_perception captured for the audit
  trail. Manager-vs-peer is *derived* from participants' `role_in_sim`; no
  `phase` column.
- **Self-perception privacy.** Drilldown returns the subject avatar's own
  self_perception only; other participants' self_perception fields are
  filtered out at the response shaper.

## Key design decisions

| Decision | Choice | Why |
|---|---|---|
| Org cardinality | Exactly 1 manager + N≥1 workers, single team | Scoped iteration |
| Round shape | Manager phase (N) → peer phase (K=N) → settle | Phase-grouped engine code, no `phase` column in DB |
| Pair sampling | Deterministic, seeded uniform random with no within-round duplicate until unique-pair space exhausted | Reproducibility; reputation weighting deferred |
| Within-round state | Strict serial; running state mutated after each interaction | Causal chaining is the whole point; loses LLM parallelism but tolerable at prototype scale |
| Self-perception | Singleton string per avatar, updated every interaction | Per-relationship matrix deferred |
| Manager-vs-peer | Derived from participants' `role_in_sim` | Forward-compat: skip-levels, mixed-role interactions are additive |
| LLM call counting | N (manager 1:1s = 1 free-text + 1 structured each = 2N) + 2K (peer = 2 structured each) → 4N per round | Keep manager 1:1 free-text; structured for everything that emits morale |
| Unified turn schema | `AvatarTurnSchema` for every structured emission | Replaces prototype's `WorkerResponseSchema` |
| Data writes | Per-interaction insert + per-round settle TX | Live drilldown updates require interactions to be visible mid-round; settle bumps `rounds_completed` + `paper_total` atomically |
| Validation | Zod on inbound HTTP and on LLM structured responses | Defense in depth |
| Migration | Drop the prototype DB and `pnpm db:push` | Greenfield — no migration files |

## Data flow — "user starts a multi-worker run"

```
POST /runs
  ├─ validate body (Zod): exactly 1 manager + ≥1 workers, unique names
  ├─ generate avatar uuids, build config_json snapshot (avatars w/ ids, model, temp, seed)
  ├─ INSERT run row (status='pending')
  ├─ INSERT one avatar row per request avatar
  ├─ reply 201 { id }
  └─ setImmediate(() => runner.run(id))           ── fire-and-forget

runner.run(id):
  ├─ load run, parse config_json, load avatars (manager + workers)
  ├─ UPDATE run SET status='running'
  ├─ workerState: Map<avatarId, { selfPerception, morale, moraleRationale }>
  └─ for round_index in 1..rounds_total:
       ├─ re-read run.status; exit if not 'running'        (cooperative cancel)
       ├─ tag = pickTag(seed, round_index)
       ├─ INSERT round row
       ├─ Manager phase: for each worker (seeded order):
       │     managerMsg = llm.complete(buildManagerPrompt(...))
       │     workerTurn = llm.completeStructured(buildWorker1on1Prompt(...), AvatarTurnSchema)
       │     INSERT interaction row (initiator=manager, responder=worker, manager-side morale NULL)
       │     mutate workerState[worker]
       ├─ Peer phase: pairs = samplePairs(seed, round_index, K=workers.length)
       │     for each (a, b): orientPair, two structured calls, INSERT interaction
       │     mutate workerState[initiator] + workerState[responder]
       └─ Settle (TX):
            for each worker: INSERT round_avatar (morale, paper_sold = round(baseline*morale/50))
            INSERT round_avatar for manager (morale/paper_sold NULL)
            UPDATE run SET rounds_completed = round_index, paper_total += sum(paper_sold)
  └─ UPDATE run SET status='completed'    (or 'failed' on throw)

GET /runs/:id  ──  dashboard read (no interaction text; per-avatar morale curves)
GET /runs/:id/avatars/:avatarId  ──  drilldown read (interactions + per-round state for one avatar)
```

## Module map

```
packages/shared/src/
  types.ts            # Avatar, AvatarRole, RunConfig, RunStatus,
                      # RunListItem, RunDetail (dashboard), AvatarDetail (drilldown)
  llm-client.ts       # LLMClient interface, Message, LLMCallOptions, AvatarTurnSchema
  situation-tags.ts   # SITUATION_TAGS, pickTag(seed, roundIndex)            (unchanged)
  pair-sampling.ts    # samplePairs(workers, K, seed), orientPair(a, b, seed)
  presets.ts          # AvatarPreset, PRESETS, PRESETS_BY_ROLE
  index.ts            # barrel re-exports

apps/api/src/
  index.ts            # Fastify bootstrap, CORS, route registration
  db/
    schema.ts         # Drizzle: run, avatar, round, round_avatar, interaction
    index.ts          # AppDb bundle + repos: runs, avatars, rounds, roundAvatars, interactions
  routes/
    runs.ts           # POST /runs, GET /runs, GET /runs/:id (dashboard)
    avatars.ts        # GET /runs/:id/avatars/:avatarId (drilldown, ?partner=)
    schemas.ts        # Zod request schemas + response shapers (toRunDetail, toAvatarDetail)
  engine/
    runner.ts         # Runner — runRound, runManagerPhase, runPeerPhase, settle
    prompts.ts        # buildManagerPrompt, buildWorker1on1Prompt,
                      # buildPeerInitiatorPrompt, buildPeerResponderPrompt
    scoring.ts        # paperSold, teamExpected, workerExpectedShare, signedDelta
    transcript.ts     # formatPairHistory (manager↔W or A↔B), formatTodaySoFar
  llm/
    index.ts          # createLLMClient() factory                            (unchanged)
    openai-client.ts  # OpenAIClient implements LLMClient                    (unchanged)
    retry.ts          # withRetry(fn) — exponential backoff                  (unchanged)
    errors.ts         # LLMError, MalformedStructuredOutputError, etc.       (unchanged)
```

The `llm/` directory is deliberately untouched — the provider abstraction is
the same interface as the prototype; only the call sites move.

## Open questions

- **Per-round transaction scope.** The pseudocode wraps the entire settle
  step in a TX. Whether to also include the per-interaction inserts is open;
  current scaffold splits — interactions stream in (so live drilldown can see
  them), settle is a TX. The trade-off is a partial round on crash; acceptable
  per `data-model.md`'s concurrency notes.
- **`config_json` schema formalization.** Loose during prototype; will tighten
  when running real experiments.
- **Manager state.** Schema supports it (manager `round_avatar.morale` is
  nullable); v1 always writes NULL. Flag-flip later.
- **Token-cost / per-call observability.** No `llm_calls` table — deferred.
