# High-Level Architecture — Initial Prototype

## Goal

Build a 2-agent (one manager, one worker) paper-company work simulator
end-to-end in a few days. The user configures personalities and a sales target,
runs N rounds, and watches morale and paper-sold evolve as the manager and
worker interact.

The prototype validates one core hypothesis: **does manager style × worker
values measurably affect the output number?** Everything in the architecture
serves that question while staying cheap to extend toward richer simulations
(more agents, peer interactions, experiments with replicates).

For decision rationale, see `locked-decisions.md`.

---

## System diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                              Browser                                 │
│                                                                      │
│   Next.js (App Router) + React + Tailwind                            │
│   ┌──────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│   │  Runs List   │  │  Setup (/new)  │  │   Run Detail (/runs/x) │  │
│   │     (/)      │  │                │  │   ◀── polls every 2s ──┤  │
│   └──────────────┘  └────────────────┘  └────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │  HTTP (JSON)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   Fastify (Node + TypeScript)                        │
│                                                                      │
│   API layer                       Simulation engine                  │
│   ┌────────────────────┐          ┌────────────────────────────────┐ │
│   │ GET  /runs         │          │  Runner (in-process async)     │ │
│   │ POST /runs         │─────────▶│   for round_index in 1..N:     │ │
│   │ GET  /runs/:id     │          │     pick situation_tag         │ │
│   └────────────────────┘          │     manager turn (LLM)         │ │
│            │                      │     worker turn (LLM)          │ │
│            │                      │     compute paper_sold         │ │
│            ▼                      │     write rounds row           │ │
│   ┌──────────────┐                │     check status flag          │ │
│   │  Drizzle ORM │◀───────────────┤                                │ │
│   └──────┬───────┘                └────────────────┬───────────────┘ │
│          │                                         │                 │
│          ▼                                         ▼                 │
│   ┌──────────────┐                     ┌──────────────────────┐      │
│   │   SQLite     │                     │     LLMClient        │      │
│   │  (one file)  │                     │ ┌──────────────────┐ │      │
│   └──────────────┘                     │ │  OpenAIClient    │ │      │
│                                        │ ├──────────────────┤ │      │
│                                        │ │ AnthropicClient  │ │      │
│                                        │ │   (later)        │ │      │
│                                        │ └──────────────────┘ │      │
│                                        └──────────┬───────────┘      │
└───────────────────────────────────────────────────┼──────────────────┘
                                                    │
                                                    ▼
                                          ┌──────────────────┐
                                          │  OpenAI API      │
                                          │  (gpt-4.1)       │
                                          └──────────────────┘
```

---

## Components and responsibilities

| Component | Responsibility | Doc |
|---|---|---|
| **Frontend (React)** | Setup form, runs list, run detail with live polling. Renders transcripts, morale curves, paper totals. Stateless — server is source of truth. | `frontend.md` |
| **API (Fastify)** | Thin HTTP layer over the DB and runner. Validates requests, snapshots config, kicks off runner, exposes read endpoints. | `api.md` |
| **Simulation engine** | Per-round runner loop. Picks situation tag, builds prompts, calls `LLMClient`, computes `paper_sold`, persists round, checks for status changes. | `simulation-engine.md` |
| **`LLMClient` abstraction** | Provider-agnostic interface (`complete`, `completeStructured`). Internal retry on transient errors. Re-validates structured output with Zod. | `llm-client.md` |
| **Data model (SQLite + Drizzle)** | Two tables: `runs` (one row per simulation, with full input snapshot) and `rounds` (one row per completed round). Append-only in v1. | `data-model.md` |
| **Presets** | Static TypeScript module of Office-themed agent profiles. Lives in `packages/shared`. No DB rows. | `presets.md` |

---

## The canonical data flow: "user starts a sandbox run"

1. User opens `/new`, picks preset "Michael Scott" for manager and "Jim Halpert"
   for worker, sets target = 500, rounds = 10. Hits **Run**.
2. Frontend `POST /runs` with `{ agents, target_paper, rounds_total, model,
   temperature }`.
3. API:
   - Builds the immutable `config_json` blob (snapshots agent profiles, model
     params, prompt template version, picks a `situation_tag_seed`,
     stamps `sim_engine_version`).
   - Inserts `runs` row with `status='pending'`, `experiment_id=null`.
   - Returns `{ id }` to frontend immediately.
   - Fire-and-forgets the runner (`setImmediate(() => runner.run(id))`).
4. Frontend navigates to `/runs/:id` and starts polling `GET /runs/:id` every 2s.
5. Runner:
   - Sets `status='running'`.
   - For each round 1..N:
     - Computes `situation_tag` from seed + round_index.
     - Calls `LLMClient.complete(...)` for manager turn.
     - Calls `LLMClient.completeStructured(...)` for worker turn.
     - Computes `paper_sold` from `morale`.
     - Inserts `rounds` row.
     - Updates `runs.rounds_completed` and `runs.paper_total`.
     - Re-reads `runs.status`; if not `running`, breaks.
   - Sets `status='completed'`.
6. On each poll, frontend gets the latest run state with all completed rounds
   so far. Renders new rounds as they appear; stops polling when status is
   terminal.
7. On any persistent LLM failure: runner sets `status='failed'`, populates
   `error_message` and `failed_at_round`, stops. Frontend renders the failure
   state.

---

## Forward-compat affordances we're paying for now

These are the small disciplines that cost almost nothing today and unlock major
features later without rewrites:

| Discipline | Future feature it enables |
|---|---|
| Persist each round to DB the moment it completes | SSE streaming, pause/resume, crash recovery, mid-run event injection |
| Symmetric agent schema (`morale`, `self_perception` on every agent) | Bidirectional manager↔worker dynamics — flag flip, not migration |
| `LLMClient` interface in `packages/shared` | Provider swaps, multi-provider A/B testing |
| Snapshot inputs into `config_json` instead of FK | Editing presets later doesn't contaminate historical runs |
| Capture every variance source in `config_json` | Reproducible experiments; differences between runs attributable |
| Nullable `experiment_id` column + autocomputed condition hash | "Experiments view" that groups runs by replicate-condition |
| Status state machine with `paused`, `cancelled` slots reserved | Pause/resume/cancel are state-machine flips |

---

## Out of scope for the prototype

Explicit non-goals:

- **Auth, multi-user, multi-tenant.** Single user, single local server.
- **More than 2 agents.** Schema doesn't preclude it, but the UI and prompt
  templates assume 1 manager + 1 worker.
- **Peer-to-peer (worker↔worker) interactions.** Manager↔worker only.
- **Memory infrastructure** (vector store, embeddings, retrieval, reflection).
  Full transcript in prompt is enough at this scale.
- **SSE / websockets / token streaming.** Polling only.
- **Pause / resume / cancel / mid-run injection.** Schema reserves slots; no
  endpoints or UI.
- **Experiments view, replicate runs, comparison UI.** Schema reserves the
  `experiment_id` column; no UI exposes it.
- **Saved user-authored agent profiles.** Edit the preset values in the form
  each time.
- **Cost / token accounting and rate-limit dashboards.**
- **Production deployment.** Local `pnpm dev` only.
- **Manager has morale or output.** Schema reserves the columns; runner
  doesn't update them yet.

---

## Repository layout (planned)

```
work-sim/
├── apps/
│   ├── api/                    # Fastify server + simulation engine
│   │   ├── src/
│   │   │   ├── index.ts        # Fastify bootstrap
│   │   │   ├── routes/         # HTTP endpoints
│   │   │   ├── engine/         # Runner, prompt builders, situation tags
│   │   │   ├── db/             # Drizzle schema + migrations
│   │   │   └── llm/            # OpenAIClient implementation
│   │   └── package.json
│   └── web/                    # Next.js (App Router) + React + Tailwind
│       ├── app/                # File-system routes (page.tsx per route)
│       │   ├── layout.tsx      # Root layout (nav + container)
│       │   ├── page.tsx        # /            (runs list)
│       │   ├── new/page.tsx    # /new         (setup form)
│       │   └── runs/[id]/page.tsx  # /runs/:id (run detail w/ polling)
│       ├── components/
│       ├── hooks/              # use-run-polling, use-runs
│       ├── lib/api.ts          # Fetch wrappers + types
│       └── package.json
├── packages/
│   └── shared/                 # Cross-boundary TS types + LLMClient interface
│       ├── src/
│       │   ├── types.ts        # Run, Round, AgentProfile, etc.
│       │   ├── llm-client.ts   # Interface + Zod schemas
│       │   └── presets.ts      # Office-themed agent presets
│       └── package.json
├── docs/
│   ├── initial-requirements.md
│   └── initial-prototype/
│       ├── locked-decisions.md
│       ├── high-level-arch.md  ← this file
│       ├── data-model.md
│       ├── llm-client.md
│       ├── simulation-engine.md
│       ├── api.md
│       ├── frontend.md
│       └── presets.md
└── package.json                # Root: dev scripts, shared lint/format config
```

No npm workspaces; cross-package imports use a tsconfig path alias
(`@work-sim/shared` → `../packages/shared/src`). Switch to workspaces if and
when the package count grows.
