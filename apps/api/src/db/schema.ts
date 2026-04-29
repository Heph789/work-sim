// Drizzle schema for the many-workers iteration. Mirrors
// docs/tmp/many-workers-backend/schema.sql one-to-one. The SQL file is the
// canonical migration artifact; this TS schema is what the application talks
// to.
//
// Five tables: run, avatar, round, round_avatar, interaction. All singular.
// Manager-vs-peer is DERIVED from participants' role_in_sim — no `phase`
// column. Per docs/many-workers/data-model.md.

// DEPENDENCY: drizzle-orm
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

// ─── run ────────────────────────────────────────────────────────────────────

/**
 * One row per simulation. Status state machine is enforced in the runner —
 * pending → running → (completed | failed | cancelled). `config_json` is the
 * immutable input snapshot used for reproducibility.
 */
export const run = sqliteTable(
  'run',
  {
    /** Server-generated uuid. */
    id: text('id').primaryKey(),
    /** Unix milliseconds; set once on insert. Drives runs-list ordering. */
    createdAt: integer('created_at').notNull(),
    /** State-machine column. Indexed for crash-recovery query. */
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    }).notNull(),
    /** Configured round count; immutable. */
    roundsTotal: integer('rounds_total').notNull(),
    /** Bumped during settle. */
    roundsCompleted: integer('rounds_completed').notNull().default(0),
    /** Team-level goal across the run. */
    targetPaper: integer('target_paper').notNull(),
    /** Sum of round_avatar.paper_sold across workers across rounds. */
    paperTotal: integer('paper_total').notNull().default(0),
    /** Reserved for future experiments view. */
    experimentId: text('experiment_id'),
    /** Full input snapshot — JSON-stringified RunConfig. Immutable post-insert. */
    configJson: text('config_json').notNull(),
    /** Populated only when status='failed'. */
    errorMessage: text('error_message'),
    /** Round index where the run failed. */
    failedAtRound: integer('failed_at_round'),
  },
  (t) => ({
    statusIdx: index('run_status_idx').on(t.status),
    experimentIdx: index('run_experiment_idx').on(t.experimentId),
    createdIdx: index('run_created_idx').on(t.createdAt),
  }),
);

// ─── avatar ─────────────────────────────────────────────────────────────────

/**
 * One row per persona per run. Materialized so FKs from interaction and
 * round_avatar are stable strings rather than JSON paths. Profile is also
 * snapshotted in run.config_json for reproducibility — the table is the
 * queryable canonical for FKs.
 */
export const avatar = sqliteTable(
  'avatar',
  {
    /** uuid; same id stored in config_json.avatars[].id. */
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    roleInSim: text('role_in_sim', { enum: ['manager', 'worker'] }).notNull(),
    name: text('name').notNull(),
    roleLabel: text('role_label').notNull(),
    personality: text('personality').notNull(),
    values: text('values').notNull(),
    /** Used in paper-sold formula for workers; ignored for managers in v1. */
    baselineOutput: integer('baseline_output').notNull(),
  },
  (t) => ({
    /** Drives "all avatars in this run" reads. */
    runIdx: index('avatar_run_idx').on(t.runId),
    /** Drives "list workers in run" — used by runner and dashboard. */
    runRoleIdx: index('avatar_run_role_idx').on(t.runId, t.roleInSim),
  }),
);

// ─── round ──────────────────────────────────────────────────────────────────

/**
 * One row per "day." Slim — per-worker state moved to round_avatar. Inserted
 * once at the start of each round; subsequent interactions and round_avatar
 * rows reference it.
 */
export const round = sqliteTable(
  'round',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    /** 1-based; UNIQUE per run. */
    roundIndex: integer('round_index').notNull(),
    /**
     * Deterministic from (config_json.situation_tag_seed, round_index). Shared
     * by all interactions in this round; denormalized onto interaction rows.
     */
    situationTag: text('situation_tag').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    runRoundIdx: uniqueIndex('round_run_round_idx').on(t.runId, t.roundIndex),
  }),
);

// ─── round_avatar ───────────────────────────────────────────────────────────

/**
 * One row per (round, avatar). Captures end-of-round running state. Written
 * during settle. Manager rows have NULL morale and paper_sold in v1; the
 * column shape is symmetric for the future bidirectional case.
 */
export const roundAvatar = sqliteTable(
  'round_avatar',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    roundId: text('round_id')
      .notNull()
      .references(() => round.id, { onDelete: 'cascade' }),
    /** Denormalized to avoid a round-join on per-avatar feed queries. */
    roundIndex: integer('round_index').notNull(),
    avatarId: text('avatar_id')
      .notNull()
      .references(() => avatar.id, { onDelete: 'cascade' }),
    /** 0–100 for workers; NULL for manager in v1. */
    morale: integer('morale'),
    moraleRationale: text('morale_rationale'),
    /** Avatar's last-emitted self_perception this round; NULL for manager. */
    selfPerception: text('self_perception'),
    /** round(baseline * morale / 50) for workers; NULL for manager. */
    paperSold: integer('paper_sold'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    unique: uniqueIndex('round_avatar_unique_idx').on(
      t.runId,
      t.roundId,
      t.avatarId,
    ),
    /** Drives "avatar's morale-over-rounds" sparkline + chart queries. */
    feedIdx: index('round_avatar_feed_idx').on(
      t.runId,
      t.avatarId,
      t.roundIndex,
    ),
  }),
);

// ─── interaction ────────────────────────────────────────────────────────────

/**
 * One row per LLM exchange. Append-only audit trail powering the avatar feed
 * and pair filter. Manager-vs-peer is DERIVED from participants' role_in_sim;
 * the engine assigns 0-based order_in_round so 1:1s are 0..N-1 and peer
 * convos N..2N-1 within a round.
 *
 * Initiator-side morale/rationale/self_perception are NULL when the initiator
 * is the manager (v1). Responder-side is always populated — responders are
 * always workers in v1 (manager→worker 1:1, or peer worker↔worker).
 */
export const interaction = sqliteTable(
  'interaction',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    roundId: text('round_id')
      .notNull()
      .references(() => round.id, { onDelete: 'cascade' }),
    /** Denormalized for sort. */
    roundIndex: integer('round_index').notNull(),
    /** 0-based. UNIQUE with round_id; drives render order. */
    orderInRound: integer('order_in_round').notNull(),
    /** Denormalized for filter convenience. */
    situationTag: text('situation_tag').notNull(),
    initiatorAvatarId: text('initiator_avatar_id')
      .notNull()
      .references(() => avatar.id),
    responderAvatarId: text('responder_avatar_id')
      .notNull()
      .references(() => avatar.id),
    initiatorMessage: text('initiator_message').notNull(),
    responderMessage: text('responder_message').notNull(),
    initiatorMorale: integer('initiator_morale'),
    initiatorMoraleRationale: text('initiator_morale_rationale'),
    initiatorSelfPerception: text('initiator_self_perception'),
    responderMorale: integer('responder_morale').notNull(),
    responderMoraleRationale: text('responder_morale_rationale').notNull(),
    responderSelfPerception: text('responder_self_perception').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    /** Render order across the run; UNIQUE prevents double-write of a slot. */
    orderIdx: uniqueIndex('interaction_order_idx').on(
      t.runId,
      t.roundIndex,
      t.orderInRound,
    ),
    /** Per-avatar feed (initiator side). */
    initiatorIdx: index('interaction_initiator_idx').on(
      t.runId,
      t.initiatorAvatarId,
    ),
    /** Per-avatar feed (responder side). */
    responderIdx: index('interaction_responder_idx').on(
      t.runId,
      t.responderAvatarId,
    ),
    /** Pair filter (combine with reverse-direction query for unordered pair). */
    pairIdx: index('interaction_pair_idx').on(
      t.runId,
      t.initiatorAvatarId,
      t.responderAvatarId,
    ),
  }),
);

// ─── Convenience row types ──────────────────────────────────────────────────

export type RunRow = typeof run.$inferSelect;
export type NewRunRow = typeof run.$inferInsert;
export type AvatarRow = typeof avatar.$inferSelect;
export type NewAvatarRow = typeof avatar.$inferInsert;
export type RoundRow = typeof round.$inferSelect;
export type NewRoundRow = typeof round.$inferInsert;
export type RoundAvatarRow = typeof roundAvatar.$inferSelect;
export type NewRoundAvatarRow = typeof roundAvatar.$inferInsert;
export type InteractionRow = typeof interaction.$inferSelect;
export type NewInteractionRow = typeof interaction.$inferInsert;
