// Drizzle schema for the two prototype tables. Mirrors
// docs/tmp/backend/schema.sql one-to-one. The SQL file is the canonical
// migration artifact; this TS schema is what the application talks to.
//
// Per docs/initial-prototype/data-model.md.

// DEPENDENCY: drizzle-orm
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

/**
 * One row per simulation. Status state machine is enforced in the runner,
 * not by DB triggers — the legal transitions are
 * pending → running → (completed | failed | cancelled).
 *
 * `config_json` is loose-shape during prototype; tighten with a Zod schema
 * once we start running real experiments.
 */
export const runs = sqliteTable(
  'runs',
  {
    /** Server-generated UUID. */
    id: text('id').primaryKey(),

    /** Unix milliseconds; set once on insert. Drives runs-list ordering. */
    createdAt: integer('created_at').notNull(),

    /** State-machine column. Indexed for crash-recovery query. */
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    }).notNull(),

    /** Configured round count; immutable. */
    roundsTotal: integer('rounds_total').notNull(),

    /** Bumped by the runner inside the per-round transaction. */
    roundsCompleted: integer('rounds_completed').notNull().default(0),

    /** Manager-only goal across the run. Read by the manager prompt builder. */
    targetPaper: integer('target_paper').notNull(),

    /** Running sum of paper_sold across completed rounds. */
    paperTotal: integer('paper_total').notNull().default(0),

    /** Nullable for sandbox runs. Reserved for the future experiments view. */
    experimentId: text('experiment_id'),

    /** Full input snapshot — JSON-stringified RunConfig. Immutable post-insert. */
    configJson: text('config_json').notNull(),

    /** Populated only when status='failed'. Surfaced to UI. */
    errorMessage: text('error_message'),

    /** Round index where the run failed (no rounds row was written for it). */
    failedAtRound: integer('failed_at_round'),
  },
  (t) => ({
    /** Future crash-recovery: SELECT * FROM runs WHERE status='running'. */
    statusIdx: index('runs_status_idx').on(t.status),
    /** Future experiments view aggregations. */
    experimentIdx: index('runs_experiment_idx').on(t.experimentId),
    /** Runs-list pagination (newest first). */
    createdIdx: index('runs_created_idx').on(t.createdAt),
  }),
);

/**
 * One row per *successfully completed* round. Failed rounds produce no row;
 * the run just transitions to 'failed' with `failed_at_round` populated.
 */
export const rounds = sqliteTable(
  'rounds',
  {
    id: text('id').primaryKey(),

    /** Cascade is defensive — we don't delete in v1. */
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),

    /** 1-based; unique per run. Drives transcript ordering. */
    roundIndex: integer('round_index').notNull(),

    /** Deterministically picked from situation_tag_seed + round_index. */
    situationTag: text('situation_tag').notNull(),

    /** Free-text manager turn (LLMClient.complete). */
    managerMessage: text('manager_message').notNull(),

    /** The 'message' field of the worker's structured response. */
    workerMessage: text('worker_message').notNull(),

    /** The worker's updated_self_perception — private; manager prompts never see it. */
    workerSelfPerception: text('worker_self_perception').notNull(),

    /** Worker's stated reason for the morale value this round. Debug aid. */
    workerMoraleRationale: text('worker_morale_rationale').notNull(),

    /** 0–100. Validated by Zod after the LLM response is parsed. */
    morale: integer('morale').notNull(),

    /** round(baseline * morale / 50). Computed by the engine. */
    paperSold: integer('paper_sold').notNull(),

    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    /** Drives "rounds for this run, in order" reads + prevents double-writes. */
    runRoundIdx: uniqueIndex('rounds_run_round_idx').on(t.runId, t.roundIndex),
  }),
);

/** Convenience row-types for use in repos and route handlers. */
export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;
export type RoundRow = typeof rounds.$inferSelect;
export type NewRoundRow = typeof rounds.$inferInsert;
