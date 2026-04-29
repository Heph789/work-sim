# Data Model — Many Workers

Five tables: `run`, `avatar`, `round`, `round_avatar`, `interaction`. All
singular. Append-only — no edits or deletes through the API.

For why this shape, see `design.md` (especially §11 Schema, §6 Self-perception,
§10 Paper-sold).

This iteration **replaces** the prototype's two-table model (`runs`, `rounds`).
The project is greenfield with no backwards-compatibility constraints — we
rename and reshape rather than evolve.

---

## `run`

One row per simulation. Same lifecycle as the prototype's `runs`.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` (uuid) PK | Server-generated. |
| `created_at` | `integer` (unix ms) | Set once on insert. |
| `status` | `text` | `pending` \| `running` \| `completed` \| `failed` \| `cancelled`. Indexed. |
| `rounds_total` | `integer` | Configured round count. |
| `rounds_completed` | `integer` | Bumped by runner after each round settles. |
| `target_paper` | `integer` | Team-level goal. |
| `paper_total` | `integer` | Sum of all `round_avatar.paper_sold` so far. |
| `experiment_id` | `text` (nullable) | Reserved for future experiments view. |
| `config_json` | `text` (JSON) | Full input snapshot, including all avatar profile fields. |
| `error_message` | `text` (nullable) | Populated on `failed`. |
| `failed_at_round` | `integer` (nullable) | Round index where the run failed. |

### `config_json` shape

```jsonc
{
  "avatars": [
    {
      "id": "<uuid>",                    // matches the avatar table row
      "role_in_sim": "manager",
      "name": "Michael Scott",
      "role_label": "Regional Manager",
      "personality": "...",
      "values": "...",
      "baseline_output": 1               // managers: 0 or 1, ignored for paper math
    },
    {
      "id": "<uuid>",
      "role_in_sim": "worker",
      "name": "Jim Halpert",
      "role_label": "Sales Representative",
      "personality": "...",
      "values": "...",
      "baseline_output": 14
    },
    { "id": "<uuid>", "role_in_sim": "worker", /* ... */ }
  ],
  "model": "gpt-4o-mini",
  "temperature": 0.8,
  "top_p": 1.0,
  "prompt_template_version": "v2",       // bumped from prototype's "v1"
  "situation_tag_seed": 1738271462,
  "sim_engine_version": "v2"             // bumped
}
```

The `avatar` table is the queryable canonical for FKs; `config_json` is the
immutable snapshot for experimental reproducibility (so editing an `avatar`
row tomorrow can't contaminate today's run).

### Indexes

- `run(status)` — runner's "pick up running rows on boot" query.
- `run(experiment_id)` — future experiments view aggregations.
- `run(created_at DESC)` — runs list pagination.

---

## `avatar`

One row per persona per run. Materialized so foreign keys from `interaction`
and `round_avatar` are stable strings rather than JSON paths.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` (uuid) PK | Same id used in `config_json.avatars[].id`. |
| `run_id` | `text` FK → `run.id` | Cascade-on-delete (defensive). |
| `role_in_sim` | `text` | `manager` \| `worker`. |
| `name` | `text` | Display name. |
| `role_label` | `text` | E.g. "Regional Manager", "Sales Representative". |
| `personality` | `text` | Free-form. |
| `values` | `text` | Free-form. |
| `baseline_output` | `integer` | Used in paper-sold formula for workers. |

### Indexes

- `avatar(run_id)` — drives "all avatars in this run" reads.
- `avatar(run_id, role_in_sim)` — drives "list workers" queries (engine and dashboard).

### What's deliberately not on this row

- **`morale`, `self_perception`** — these are *running* state, persisted per
  round on `round_avatar`. The avatar row itself is the static profile.

---

## `round`

One row per "day." Slimmer than the prototype's `rounds` — per-worker fields
have moved to `round_avatar`.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` (uuid) PK | |
| `run_id` | `text` FK → `run.id` | Cascade-on-delete. |
| `round_index` | `integer` | 1-based; UNIQUE with `run_id`. |
| `situation_tag` | `text` | Deterministic from `(situation_tag_seed, round_index)`. Shared by all interactions in this round. |
| `created_at` | `integer` (unix ms) | |

### Indexes

- `round(run_id, round_index)` UNIQUE — drives transcript ordering and prevents double-write.

---

## `round_avatar`

One row per (round, avatar). Captures end-of-round state for that avatar.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` (uuid) PK | |
| `run_id` | `text` FK → `run.id` | Denormalized for per-run queries. |
| `round_id` | `text` FK → `round.id` | Cascade-on-delete. |
| `round_index` | `integer` | Denormalized for per-avatar feeds (avoid join). |
| `avatar_id` | `text` FK → `avatar.id` | |
| `morale` | `integer` (0–100, nullable) | NULL for manager in v1. |
| `morale_rationale` | `text` (nullable) | NULL for manager in v1. |
| `self_perception` | `text` (nullable) | NULL for manager in v1. The avatar's last-emitted self_perception this round. |
| `paper_sold` | `integer` (nullable) | NULL for manager. For workers: `round(baseline_output * morale / 50)`. |
| `created_at` | `integer` (unix ms) | |

### Indexes

- `round_avatar(run_id, round_id, avatar_id)` UNIQUE.
- `round_avatar(run_id, avatar_id, round_index)` — drives "avatar's curve over rounds" for the dashboard sparkline.

### Why a join table

A worker's morale and paper_sold are per-(round, worker), not per-round. With
N workers, putting these on `round` would mean either N pairs of nullable
columns (terrible) or a JSON blob (un-queryable). The join table is the
clean shape and gives us free per-avatar time-series queries.

The `paper_sold` field is computed at settle-time; subsequent reads avoid
re-deriving from morale.

---

## `interaction`

One row per LLM exchange. The append-only audit trail that drives the avatar
view, pair filter, and any future analytics.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` (uuid) PK | |
| `run_id` | `text` FK → `run.id` | Denormalized for per-run reads. |
| `round_id` | `text` FK → `round.id` | Cascade-on-delete. |
| `round_index` | `integer` | Denormalized for sort. |
| `order_in_round` | `integer` | 0-based position within the round. UNIQUE with `round_id`. |
| `situation_tag` | `text` | Denormalized for filter convenience. |
| `initiator_avatar_id` | `text` FK → `avatar.id` | The speaker. |
| `responder_avatar_id` | `text` FK → `avatar.id` | The reply. |
| `initiator_message` | `text` | |
| `responder_message` | `text` | |
| `initiator_morale` | `integer` (nullable) | NULL when initiator is the manager (v1). |
| `initiator_morale_rationale` | `text` (nullable) | |
| `initiator_self_perception` | `text` (nullable) | Initiator's self_perception *as updated by* this interaction. |
| `responder_morale` | `integer` | Always populated. |
| `responder_morale_rationale` | `text` | |
| `responder_self_perception` | `text` | Responder's self_perception *as updated by* this interaction. |
| `created_at` | `integer` (unix ms) | |

### Indexes

- `interaction(run_id, round_index, order_in_round)` UNIQUE — render-in-order.
- `interaction(run_id, initiator_avatar_id)` — per-avatar feed (initiator side).
- `interaction(run_id, responder_avatar_id)` — per-avatar feed (responder side).
- `interaction(run_id, initiator_avatar_id, responder_avatar_id)` — pair filter (combined with reverse-direction query).

### Manager-vs-peer is derived

There is no `phase` or `interaction_type` column. The classification is
derived: `interaction` is a manager 1:1 iff one of its participants has
`role_in_sim = 'manager'`; otherwise it is a peer interaction. The engine
encodes the rule "all 1:1s come before all peers in a round" by assigning
`order_in_round` accordingly (0..N-1 for 1:1s, N..N+K-1 for peer convos).

### Per-avatar feed query

```sql
SELECT * FROM interaction
WHERE run_id = ?
  AND (initiator_avatar_id = ? OR responder_avatar_id = ?)
ORDER BY round_index ASC, order_in_round ASC;
```

### Pair filter query

```sql
SELECT * FROM interaction
WHERE run_id = ?
  AND ( (initiator_avatar_id = ?A AND responder_avatar_id = ?B)
     OR (initiator_avatar_id = ?B AND responder_avatar_id = ?A) )
ORDER BY round_index ASC, order_in_round ASC;
```

---

## What's deliberately *not* a table

- **`message`.** The transcript is reconstructed from `interaction` rows
  (`initiator_message` + `responder_message` per interaction).
- **`phase`.** Implicit in participants' roles + `order_in_round`.
- **`reputation` matrix** between avatars. Deferred — schema accommodates a
  future `pair_state(run_id, avatar_a, avatar_b, score)` table without
  changes here.
- **`llm_calls`.** Same as prototype — defer.
- **`event`** (mid-run injection). Same as prototype — defer.
- **`experiment`.** Implied by `experiment_id`; materialize as aggregate query.

---

## Drizzle schema sketch

```ts
// apps/api/src/db/schema.ts
import {
  sqliteTable, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core';

export const run = sqliteTable('run', {
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
  statusIdx: index('run_status_idx').on(t.status),
  experimentIdx: index('run_experiment_idx').on(t.experimentId),
  createdIdx: index('run_created_idx').on(t.createdAt),
}));

export const avatar = sqliteTable('avatar', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  roleInSim: text('role_in_sim', { enum: ['manager', 'worker'] }).notNull(),
  name: text('name').notNull(),
  roleLabel: text('role_label').notNull(),
  personality: text('personality').notNull(),
  values: text('values').notNull(),
  baselineOutput: integer('baseline_output').notNull(),
}, (t) => ({
  runIdx: index('avatar_run_idx').on(t.runId),
  runRoleIdx: index('avatar_run_role_idx').on(t.runId, t.roleInSim),
}));

export const round = sqliteTable('round', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  roundIndex: integer('round_index').notNull(),
  situationTag: text('situation_tag').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  runRoundIdx: uniqueIndex('round_run_round_idx').on(t.runId, t.roundIndex),
}));

export const roundAvatar = sqliteTable('round_avatar', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  roundId: text('round_id').notNull().references(() => round.id, { onDelete: 'cascade' }),
  roundIndex: integer('round_index').notNull(),
  avatarId: text('avatar_id').notNull().references(() => avatar.id, { onDelete: 'cascade' }),
  morale: integer('morale'),
  moraleRationale: text('morale_rationale'),
  selfPerception: text('self_perception'),
  paperSold: integer('paper_sold'),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  unique: uniqueIndex('round_avatar_unique_idx').on(t.runId, t.roundId, t.avatarId),
  feedIdx: index('round_avatar_feed_idx').on(t.runId, t.avatarId, t.roundIndex),
}));

export const interaction = sqliteTable('interaction', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  roundId: text('round_id').notNull().references(() => round.id, { onDelete: 'cascade' }),
  roundIndex: integer('round_index').notNull(),
  orderInRound: integer('order_in_round').notNull(),
  situationTag: text('situation_tag').notNull(),
  initiatorAvatarId: text('initiator_avatar_id').notNull().references(() => avatar.id),
  responderAvatarId: text('responder_avatar_id').notNull().references(() => avatar.id),
  initiatorMessage: text('initiator_message').notNull(),
  responderMessage: text('responder_message').notNull(),
  initiatorMorale: integer('initiator_morale'),
  initiatorMoraleRationale: text('initiator_morale_rationale'),
  initiatorSelfPerception: text('initiator_self_perception'),
  responderMorale: integer('responder_morale').notNull(),
  responderMoraleRationale: text('responder_morale_rationale').notNull(),
  responderSelfPerception: text('responder_self_perception').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  orderIdx: uniqueIndex('interaction_order_idx').on(t.runId, t.roundIndex, t.orderInRound),
  initiatorIdx: index('interaction_initiator_idx').on(t.runId, t.initiatorAvatarId),
  responderIdx: index('interaction_responder_idx').on(t.runId, t.responderAvatarId),
  pairIdx: index('interaction_pair_idx').on(t.runId, t.initiatorAvatarId, t.responderAvatarId),
}));
```

---

## Concurrency model

- Single Node process; single SQLite file. WAL journal mode.
- Per-round work happens inside one transaction at the end of the round
  (insert all `interaction` rows for the round + all `round_avatar` rows +
  bump `run.rounds_completed`/`paper_total`). Earlier strategy of
  per-interaction transactions is also acceptable; choose the runner pattern
  in `simulation-engine.md`.
- Polling endpoints are pure reads.

---

## Migration approach

Greenfield: drop and recreate. The prototype's `*.db` files are disposable.
`pnpm db:push` regenerates the schema from `schema.ts`. No SQL migration
files needed for this iteration.
