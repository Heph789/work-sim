# High-Level Architecture — Many Workers

## Goal

Extend the prototype from 1-manager-and-1-worker to **1 manager + N workers**,
introduce **worker↔worker peer interactions**, and persist every interaction to
a queryable table. The user runs a sim with a small team, watches morale and
output evolve per worker on a live dashboard, and drills into any single
worker's day-to-day interactions.

This iteration validates the next hypothesis after the prototype: **does adding
peer dynamics (workers interacting with each other) measurably shape the team's
morale and output, beyond what the manager alone produces?**

For decision rationale, see `design.md`. This file is the structural overview
and pointer to the deep-dives.

---

## What changes from the prototype

| Concern | Prototype | Many-workers |
|---|---|---|
| Org cardinality | 1 manager + 1 worker | 1 manager + N workers (N ≥ 1) |
| Round shape | One manager↔worker exchange | A "day" with two phases: manager 1:1s + peer pair convos |
| Interaction storage | One row per round (manager_message + worker_message inline) | One `interaction` row per LLM exchange; round table slimmed; per-worker round state in a new `round_avatar` table |
| Terminology | "agent" | **"avatar"** everywhere — code, types, prompts, docs |
| Table naming | Plural (`runs`, `rounds`) | Singular (`run`, `round`, `avatar`, `interaction`, `round_avatar`) |
| Manager prompt context | Sees team-level pace + transcript | Sees team-level pace **and per-worker output stats** (objective only — never morale or self_perception) |
| Frontend | Run detail = transcript + chart | **Dashboard** (per-run landing) + **avatar drilldown** (per-avatar interactions); pair filter via query string |

---

## System diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                Browser                                   │
│                                                                          │
│   Next.js (App Router) + React + Tailwind                                │
│   ┌────────────┐  ┌──────────────┐  ┌─────────────────┐                  │
│   │ Runs List  │  │  Setup /new  │  │ Run Dashboard   │                  │
│   │    /       │  │              │  │ /runs/:id       │ ◀── polls 2s ─┐  │
│   └────────────┘  └──────────────┘  └────────┬────────┘                │ │
│                                              │                         │ │
│                                              ▼                         │ │
│                                  ┌────────────────────────────┐        │ │
│                                  │  Avatar drilldown          │        │ │
│                                  │  /runs/:id/avatars/:aid    │ ◀──────┘ │
│                                  │  (?partner=… for pair filt)│          │
│                                  └────────────────────────────┘          │
└─────────────────────────────────────────┬────────────────────────────────┘
                                          │ HTTP (JSON)
                                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Fastify (Node + TypeScript)                        │
│                                                                          │
│   API layer                          Simulation engine                   │
│   ┌───────────────────────────┐      ┌─────────────────────────────────┐ │
│   │ GET    /runs              │      │  Runner (in-process async)      │ │
│   │ POST   /runs              │─────▶│   for round in 1..rounds_total: │ │
│   │ GET    /runs/:id          │      │     pickTag → insert round      │ │
│   │ GET    /runs/:id/avatars/ │      │     manager phase: N 1:1s       │ │
│   │   :aid                    │      │     peer phase: K=N pair convos │ │
│   └─────────────┬─────────────┘      │     settle → round_avatar rows  │ │
│                 │                    │     bump run progress           │ │
│                 ▼                    └────────────────┬────────────────┘ │
│   ┌────────────────┐                                  │                  │
│   │   Drizzle ORM  │◀─────────────────────────────────┤                  │
│   └────────┬───────┘                                  │                  │
│            ▼                                          ▼                  │
│   ┌────────────────┐                       ┌────────────────────┐        │
│   │    SQLite      │                       │    LLMClient       │        │
│   │   (one file)   │                       │  (OpenAI in v1)    │        │
│   └────────────────┘                       └─────────┬──────────┘        │
└──────────────────────────────────────────────────────┼───────────────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │   OpenAI API    │
                                              └─────────────────┘
```

---

## Components and responsibilities

| Component | Responsibility | Doc |
|---|---|---|
| **Frontend (React)** | Setup form (N workers), runs list, dashboard, avatar drilldown with pair filter. Polls run state. | `frontend.md` |
| **API (Fastify)** | Validates 1-manager-N-workers shape, snapshots config, kicks off runner, exposes dashboard + drilldown read endpoints. | `api.md` |
| **Simulation engine** | Per-round runner. Manager phase (N 1:1s) → peer phase (K pair convos) → settle. Writes `interaction` rows live; writes `round_avatar` rows at settle. | `simulation-engine.md` |
| **`LLMClient` abstraction** | Unchanged from prototype. `complete` + `completeStructured`. The structured schema for every avatar turn is unified as `AvatarTurnSchema`. | `../initial-prototype/llm-client.md` |
| **Data model (SQLite + Drizzle)** | Five tables: `run`, `avatar`, `round`, `round_avatar`, `interaction`. All singular. Append-only. | `data-model.md` |
| **Presets** | Office-themed avatar profiles (manager + workers). Same shape as prototype, just with more worker presets so the user can build a team quickly. | `../initial-prototype/presets.md` (extended) |
| **Locked decisions** | Design tree captured at decision time. | `design.md` |

---

## The canonical data flow: "user starts a multi-worker run"

1. User opens `/new`, picks preset "Michael Scott" for manager and adds three
   worker panels: Jim, Pam, Dwight. Sets target = 1500, rounds = 10. Hits **Run**.
2. Frontend `POST /runs` with `{ avatars: [...], target_paper, rounds_total,
   model, temperature }` — exactly one `role_in_sim: 'manager'`, one or more
   `role_in_sim: 'worker'`.
3. API:
   - Validates the avatars shape (1 manager, ≥1 workers).
   - Inserts a `run` row (`status='pending'`).
   - Inserts an `avatar` row per avatar in the request.
   - Builds the immutable `config_json` blob (snapshots avatar profiles, model
     params, prompt template version, situation_tag_seed, sim_engine_version).
   - Returns `{ id }` to the frontend.
   - Fire-and-forgets the runner.
4. Frontend navigates to `/runs/:id` (dashboard) and starts polling.
5. Runner, for each round 1..N:
   - Picks a `situation_tag` from `(seed, round_index)`.
   - Inserts a `round` row.
   - **Manager phase:** for each worker (in seeded order), runs a manager 1:1.
     Each insert: `interaction` row + immediate update of the worker's running
     `self_perception` and `morale`.
   - **Peer phase:** samples K=N pairs deterministically. For each pair: orient
     initiator/responder, run two structured LLM calls, insert `interaction`
     row, update both participants' running state.
   - **Settle:** writes one `round_avatar` row per avatar capturing
     end-of-round morale + `paper_sold = round(baseline * morale / 50)` for
     workers (NULL for manager).
   - Bumps `run.rounds_completed` and `run.paper_total`.
6. Each poll, frontend fetches `GET /runs/:id` and re-renders the dashboard
   (per-avatar morale curves, paper totals, team delta). User can click an
   avatar to drill into `/runs/:id/avatars/:avatarId` for that avatar's
   interaction feed; clicking a partner name there filters by pair via query
   string.
7. On terminal status (`completed`/`failed`), polling stops.

---

## Forward-compat affordances we're paying for now

| Discipline | Future feature it enables |
|---|---|
| `interaction` table separate from `round` | Multi-turn within an interaction; injected events; sub-typed interactions (e.g. group meetings) |
| Manager-vs-peer derived from `role_in_sim`, no `phase` column | Manager↔manager, skip-level interactions, mixed-role interactions — additive |
| `round_avatar` join table | Per-avatar round summaries scale to any team size; manager state is a NOT-NULL flip later |
| Materialized `avatar` table with stable IDs | Stable FKs for cross-run reputation matrix, future agent registry |
| Snapshot of avatar profiles still in `run.config_json` | Editing avatar rows can't contaminate historical run data |
| Unified `AvatarTurnSchema` for every structured emission | Future avatar-types (e.g. assistant, customer) plug in without new schemas |
| Manager information asymmetry hard-coded into prompt builder | Adding new private-state fields (mood, fatigue) won't accidentally leak |
| Deterministic pair sampling seeded from `(situation_tag_seed, round_index)` | Reputation-weighted sampling later is a single function swap |

---

## Out of scope this iteration

- **Multi-manager / org tree.** One manager per run.
- **Reputation matrix between avatars.** Pair sampling is uniform random.
- **Manager performance reports as separate LLM artifacts.** Replaced by
  injecting per-worker output stats into 1:1 prompts.
- **Manager state.** `manager.morale` / `manager.self_perception` stay NULL.
- **LLM-driven scheduling.** Engine is fully deterministic.
- **Pause / resume / cancel / mid-run injection.** Status slots reserved.
- **Per-relationship `self_perception` matrix.** Singleton with prompt nudge.
- **Manager-attention scarcity** (manager skipping some workers a round).
- **Multi-turn interactions.** Every interaction is one-shot.

Each of the above is additive on top of the schema and engine shape — no
rewrite required.

---

## Repository layout (no structural change)

```
work-sim/
├── apps/api/                          # Fastify + engine — table renames + new tables
├── apps/web/                          # Next.js — new dashboard + avatar drilldown routes
├── packages/shared/                   # Types renamed agent→avatar; AvatarTurnSchema
├── docs/
│   ├── initial-prototype/             # frozen — companion to this dir
│   └── many-workers/                  # this iteration
│       ├── idea-dump.md
│       ├── design.md                  # locked decisions (companion to initial-prototype/locked-decisions.md)
│       ├── high-level-arch.md         # ← this file
│       ├── data-model.md
│       ├── simulation-engine.md
│       ├── api.md
│       └── frontend.md
└── package.json
```
