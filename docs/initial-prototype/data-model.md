# Data Model

Two tables: `runs` and `rounds`. Append-only in the prototype — no edits, no
deletes through the API. Agents are not a table; they live as snapshots inside
`runs.config_json`.

For why this shape, see `locked-decisions.md` (especially #5, #6, #11).

---

## `runs`

One row per simulation. The row is created when the user hits **Run** and
mutates only via well-defined transitions: `pending → running → (completed |
failed | cancelled)`.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` (uuid) PK | Generated server-side. |
| `created_at` | `integer` (unix ms) | Set once on insert. |
| `status` | `text` | One of `pending`, `running`, `completed`, `failed`, `cancelled`. Indexed. |
| `rounds_total` | `integer` | Configured round count. |
| `rounds_completed` | `integer` | Updated by the runner after each successful round write. |
| `target_paper` | `integer` | Manager-only goal across the whole run. |
| `paper_total` | `integer` | Running sum, updated alongside `rounds_completed`. |
| `experiment_id` | `text` (nullable) | Hash of replicate-conditions, or null for sandbox runs. UI doesn't expose it in v1. |
| `config_json` | `text` (JSON) | Full input snapshot — see below. |
| `error_message` | `text` (nullable) | Populated on `failed`. |
| `failed_at_round` | `integer` (nullable) | Round index where the run failed. |

### `config_json` shape (loose during prototype)

```jsonc
{
  "agents": [
    {
      "role_in_sim": "manager",     // "manager" | "worker"
      "name": "Michael Scott",
      "role_label": "Regional Manager",
      "personality": "free-form text...",
      "values": "free-form text...",
      "baseline_output": 10
    },
    { "role_in_sim": "worker", "...": "..." }
  ],
  "model": "gpt-4.1",
  "temperature": 0.8,
  "top_p": 1.0,
  "prompt_template_version": "v1",
  "situation_tag_seed": 1738271462,
  "sim_engine_version": "v1"
}
```

**Discipline:** when adding a new variance source (a new prompt template, a
new model, a new RNG dimension), add it to `config_json`. The shape stays
loose during the prototype — when we start running real experiments, we'll
formalize the keys with a Zod schema.

### Indexes

- `runs(status)` — runner picks up `running` rows on boot (future crash recovery).
- `runs(experiment_id)` — future experiments view aggregations.
- `runs(created_at DESC)` — runs list pagination.

---

## `rounds`

One row per completed round. Written *after* the round resolves successfully —
failed rounds produce no row (the run just transitions to `failed`).

| Column | Type | Notes |
|---|---|---|
| `id` | `text` (uuid) PK | |
| `run_id` | `text` FK → `runs.id` | Cascade-on-delete (defensive; we don't delete in v1). |
| `round_index` | `integer` | 1-based. Unique with `run_id`. |
| `situation_tag` | `text` | E.g. `routine_check_in`, `missed_target`. See `simulation-engine.md`. |
| `manager_message` | `text` | Free-text output of manager turn. |
| `worker_message` | `text` | From the worker turn's structured output. |
| `worker_self_perception` | `text` | The worker's `updated_self_perception`. The next round's worker prompt reads this. |
| `morale` | `integer` (0–100) | Validated by Zod after LLM response. |
| `paper_sold` | `integer` | `round(baseline * morale / 50)`. Computed by the engine. |
| `created_at` | `integer` (unix ms) | |

### Indexes

- `rounds(run_id, round_index)` — UNIQUE. Drives the run-detail rendering.

---

## What's deliberately *not* a table

- **`agents`.** Profiles live as snapshots inside `runs.config_json`. There's
  no global agent registry. Presets are a static TypeScript module, not DB
  rows. This guarantees experimental reproducibility — editing a preset
  tomorrow can't contaminate a run from today.
- **`presets`.** Same reason — they're code (`packages/shared/presets.ts`).
- **`llm_calls`.** Per-call observability (token usage, latency, raw
  request/response) would be useful but isn't load-bearing for v1. Add a
  separate `llm_calls` table later if we want cost attribution or replay.
- **`messages`.** The transcript is reconstructed from `rounds` rows
  (`manager_message` + `worker_message` per round, ordered by `round_index`).
  No separate chat-log table needed.
- **`experiments`.** Implied by `experiment_id`; materialized only as an
  aggregate query (`GROUP BY experiment_id`) when we build the experiments
  view. No row-per-experiment in v1.

---

## Drizzle schema sketch

```ts
// apps/api/src/db/schema.ts
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
  }).notNull(),
  roundsTotal: integer('rounds_total').notNull(),
  roundsCompleted: integer('rounds_completed').notNull().default(0),
  targetPaper: integer('target_paper').notNull(),
  paperTotal: integer('paper_total').notNull().default(0),
  experimentId: text('experiment_id'),
  configJson: text('config_json').notNull(),
  errorMessage: text('error_message'),
  failedAtRound: integer('failed_at_round'),
}, (t) => ({
  statusIdx: index('runs_status_idx').on(t.status),
  experimentIdx: index('runs_experiment_idx').on(t.experimentId),
  createdIdx: index('runs_created_idx').on(t.createdAt),
}));

export const rounds = sqliteTable('rounds', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  roundIndex: integer('round_index').notNull(),
  situationTag: text('situation_tag').notNull(),
  managerMessage: text('manager_message').notNull(),
  workerMessage: text('worker_message').notNull(),
  workerSelfPerception: text('worker_self_perception').notNull(),
  morale: integer('morale').notNull(),
  paperSold: integer('paper_sold').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  runRoundIdx: uniqueIndex('rounds_run_round_idx').on(t.runId, t.roundIndex),
}));
```

---

## Concurrency model

- Single Node process; single SQLite file.
- `better-sqlite3` is synchronous and safe for single-process use; one writer
  at a time is fine because the runner is the only writer and runs are
  created one at a time in the prototype.
- Per-round writes happen inside short transactions (insert into `rounds` +
  update `runs.rounds_completed`/`paper_total`).
- Polling endpoints are pure reads — no contention concerns at prototype
  scale.
- WAL journal mode is worth enabling on first connect (`PRAGMA journal_mode =
  WAL;`) so reads don't block during writes.

---

## Migration approach

- Drizzle Kit generates SQL migrations from the schema file.
- Run via `pnpm drizzle-kit push` during prototype; switch to versioned
  migrations (`drizzle-kit generate` + a runner on boot) if/when there's a
  shared dev DB to coordinate.
- For the prototype, the DB file is local and disposable; deleting it and
  recreating is the recovery story.
