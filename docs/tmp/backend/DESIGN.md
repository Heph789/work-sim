# Backend Scaffold — Design

## Overview

This is the structural scaffold for the work-sim backend, the system specified
in `docs/initial-prototype/`. The backend is a single Node + TypeScript +
Fastify process that:

1. Accepts `POST /runs` to start a 2-agent paper-company simulation.
2. Persists run state to a local SQLite file via Drizzle ORM.
3. Drives an in-process simulation engine that loops `rounds_total` times,
   making two LLM calls per round (manager free-text turn + worker structured
   turn) and writing each round to the DB the moment it completes.
4. Serves polling reads (`GET /runs`, `GET /runs/:id`) so the React frontend
   can render live progress.

The scaffold is shape-only: types, signatures, constants, and TODO bodies.
No business logic is implemented; every non-trivial body is a `// TODO`.

## Motivation

Per `locked-decisions.md`, the prototype's job is to validate one hypothesis:
*does manager style × worker values measurably affect output?* The architecture
prioritizes "cheapest path that doesn't paint us into a corner":

- **In-process async runner.** No queue, no worker pool. Single user, single
  local server.
- **SQLite + Drizzle.** Boring, fast to set up, swappable for Postgres later.
- **`LLMClient` abstraction in `packages/shared`.** Provider-agnostic so
  OpenAI → Anthropic is one factory line.
- **Snapshotted `config_json` per run.** Editing presets later cannot
  contaminate historical runs (reproducibility).
- **Per-round persistence.** Enables future SSE, pause/resume, crash recovery
  without rewrites.

## Key design decisions

| Decision | Choice | Why |
|---|---|---|
| Runner concurrency | In-process `setImmediate(...)` fire-and-forget | Single-user prototype; queue is overkill |
| DB driver | `better-sqlite3` (sync) | Safe for single-process; Drizzle has first-class support |
| ORM | Drizzle | Type-safe, migration story is `drizzle-kit push` for prototype |
| LLM provider | OpenAI (`gpt-4.1`) via `chat.completions.parse` for structured outputs | User has a key; structured-output strict-mode eliminates malformed JSON |
| Validation | Zod on inbound HTTP and on LLM structured responses | Defense in depth; same schema drives request validation and runtime checks |
| Error model | Runner catches and persists; transient LLM errors retried inside `LLMClient` | Run is the unit of failure; placeholder rounds are worse than no rounds |
| Cross-package imports | tsconfig path alias `@work-sim/shared` → `packages/shared/src` | No npm workspaces complexity for two packages |
| State machine | `pending → running → (completed | failed | cancelled)`, enforced in code | DB triggers are overkill; runner re-reads `runs.status` between rounds for cooperative cancel |

## Data flow — "user starts a run"

```
POST /runs
  ├─ validate body (Zod)
  ├─ build config_json snapshot (agents, model, temperature, seed, version)
  ├─ INSERT runs row (status='pending')
  ├─ reply 201 { id }
  └─ setImmediate(() => runner.run(id))      ── fire-and-forget

runner.run(id):
  ├─ load run + config_json
  ├─ UPDATE runs SET status='running'
  └─ for i in 1..rounds_total:
       ├─ re-read runs.status; exit if not 'running'        (cooperative cancel)
       ├─ tag = pickTag(seed, i)
       ├─ managerMsg = llm.complete(buildManagerPrompt(...))
       ├─ workerRes  = llm.completeStructured(buildWorkerPrompt(...), WorkerResponseSchema)
       ├─ paperSold  = round(baseline * morale / 50)
       └─ TX:
            INSERT rounds row
            UPDATE runs SET rounds_completed = i, paper_total += paperSold
  └─ UPDATE runs SET status='completed'    (or 'failed' on throw)

GET /runs/:id  ──  read runs + JOIN rounds, ordered by round_index
```

## Module map

```
packages/shared/src/
  types.ts            # Run, Round, AgentProfile, RunConfig, RoundView, RunListItem, RunDetail
  llm-client.ts       # LLMClient interface, Message, LLMCallOptions, WorkerResponseSchema
  situation-tags.ts   # SITUATION_TAGS, pickTag(seed, roundIndex)
  presets.ts          # AgentPreset, PRESETS, PRESETS_BY_ROLE
  index.ts            # barrel re-exports

apps/api/src/
  index.ts            # Fastify bootstrap, CORS, route registration
  db/
    schema.ts         # Drizzle table definitions
    index.ts          # DB client (better-sqlite3 + drizzle), repos (runsRepo, roundsRepo)
  routes/
    runs.ts           # POST /runs, GET /runs, GET /runs/:id
    schemas.ts        # Zod request schemas + response shapers
  engine/
    runner.ts         # Runner class — per-round loop, status state machine
    prompts.ts        # buildManagerPrompt, buildWorkerPrompt
    scoring.ts        # paperSold, paceDescription
    transcript.ts     # formatTranscript(priorRounds): string
  llm/
    index.ts          # createLLMClient() factory (provider switch on env)
    openai-client.ts  # OpenAIClient implements LLMClient
    retry.ts          # withRetry(fn) — exponential backoff for transient errors
    errors.ts         # LLMError, MalformedStructuredOutputError, etc.
```

## Open questions

- **`config_json` schema formalization.** Loose during prototype per
  `locked-decisions.md` #11; will tighten when running real experiments.
- **Crash recovery on boot.** Schema supports it (`status='running'` query)
  but not wired in v1; revisit when pause/resume lands.
- **Manager-side morale.** Schema is symmetric; runner currently only updates
  worker state. Flag-flip when bidirectional dynamics are turned on.
- **Token-cost / per-call observability.** Deferred; no `llm_calls` table in v1.
