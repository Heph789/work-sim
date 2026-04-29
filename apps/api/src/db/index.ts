// DB client + per-table repository helpers. Repos exist so the runner and
// route handlers don't pepper themselves with raw Drizzle calls — and so a
// future driver migration is localized.
//
// Concurrency: better-sqlite3 is synchronous; one writer at a time is safe
// for a single-process prototype. The runner is the only writer of round /
// round_avatar / interaction rows and the only writer of run progress
// counters.

// DEPENDENCY: better-sqlite3
import Database from 'better-sqlite3';
// DEPENDENCY: drizzle-orm
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and, or, desc, lt, asc, sql } from 'drizzle-orm';

import {
  run,
  avatar,
  round,
  roundAvatar,
  interaction,
  type RunRow,
  type NewRunRow,
  type AvatarRow,
  type NewAvatarRow,
  type RoundRow,
  type NewRoundRow,
  type RoundAvatarRow,
  type NewRoundAvatarRow,
  type InteractionRow,
  type NewInteractionRow,
} from './schema.js';

/**
 * The Drizzle database type the rest of the app sees. Exporting it lets
 * tests / fakes type-check against the same shape.
 */
export type DB = BetterSQLite3Database<{
  run: typeof run;
  avatar: typeof avatar;
  round: typeof round;
  roundAvatar: typeof roundAvatar;
  interaction: typeof interaction;
}>;

/**
 * Construct the DB client. Called once from index.ts at boot. Enables WAL
 * journal mode so polling reads don't block while the runner writes.
 *
 * @param url Path to the SQLite file. Defaults to ./work-sim.db.
 */
export function createDb(url: string = './work-sim.db'): DB {
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, {
    schema: { run, avatar, round, roundAvatar, interaction },
  });
}

// ─── Runs repository ────────────────────────────────────────────────────────

export interface RunsRepo {
  /** Insert a new run row. status='pending' on insert. */
  insert(row: NewRunRow): Promise<void>;
  /** Load a single run by id. */
  byId(id: string): Promise<RunRow | undefined>;
  /** Newest-first list with cursor pagination on created_at. */
  list(opts: { limit: number; cursor: number | null }): Promise<RunRow[]>;
  /** Status setter; used by the runner state-machine transitions. */
  setStatus(id: string, status: RunRow['status']): Promise<void>;
  /**
   * Atomic bump after a successful round settle. Caller wraps in a TX along
   * with all the round_avatar inserts for that round.
   */
  bumpProgress(
    id: string,
    roundsCompleted: number,
    paperSoldDelta: number,
  ): Promise<void>;
  /** Mark a run failed and persist failure details. */
  setFailed(
    id: string,
    args: { errorMessage: string; failedAtRound: number },
  ): Promise<void>;
}

export function createRunsRepo(db: DB): RunsRepo {
  return {
    async insert(row) {
      db.insert(run).values(row).run();
    },
    async byId(id) {
      const rows = db.select().from(run).where(eq(run.id, id)).limit(1).all();
      return rows[0];
    },
    async list({ limit, cursor }) {
      const where = cursor != null ? lt(run.createdAt, cursor) : undefined;
      const q = db.select().from(run);
      const filtered = where ? q.where(where) : q;
      return filtered.orderBy(desc(run.createdAt)).limit(limit).all();
    },
    async setStatus(id, status) {
      db.update(run).set({ status }).where(eq(run.id, id)).run();
    },
    async bumpProgress(id, roundsCompleted, paperSoldDelta) {
      db.update(run)
        .set({
          roundsCompleted,
          paperTotal: sql`${run.paperTotal} + ${paperSoldDelta}`,
        })
        .where(eq(run.id, id))
        .run();
    },
    async setFailed(id, args) {
      db.update(run)
        .set({
          status: 'failed',
          errorMessage: args.errorMessage,
          failedAtRound: args.failedAtRound,
        })
        .where(eq(run.id, id))
        .run();
    },
  };
}

// ─── Avatars repository ─────────────────────────────────────────────────────

export interface AvatarsRepo {
  /** Bulk insert at run-create time (one row per request avatar). */
  insertMany(rows: NewAvatarRow[]): Promise<void>;
  /** Load a single avatar (drilldown route). */
  byId(id: string): Promise<AvatarRow | undefined>;
  /** All avatars for a run, ordered manager-first then config-json order. */
  byRunId(runId: string): Promise<AvatarRow[]>;
}

export function createAvatarsRepo(db: DB): AvatarsRepo {
  return {
    async insertMany(rows) {
      if (rows.length === 0) return;
      db.insert(avatar).values(rows).run();
    },
    async byId(id) {
      const rows = db
        .select()
        .from(avatar)
        .where(eq(avatar.id, id))
        .limit(1)
        .all();
      return rows[0];
    },
    async byRunId(runId) {
      // TODO: order managers first then workers in config_json order. For v1
      // a stable id-asc order is enough; route shapers re-sort by role.
      return db.select().from(avatar).where(eq(avatar.runId, runId)).all();
    },
  };
}

// ─── Rounds repository ──────────────────────────────────────────────────────

export interface RoundsRepo {
  /** Insert at the start of each round. */
  insert(row: NewRoundRow): Promise<void>;
  /** Ordered by round_index ascending; drives both reads and the engine. */
  byRunId(runId: string): Promise<RoundRow[]>;
}

export function createRoundsRepo(db: DB): RoundsRepo {
  return {
    async insert(row) {
      db.insert(round).values(row).run();
    },
    async byRunId(runId) {
      return db
        .select()
        .from(round)
        .where(eq(round.runId, runId))
        .orderBy(asc(round.roundIndex))
        .all();
    },
  };
}

// ─── RoundAvatars repository ────────────────────────────────────────────────

export interface RoundAvatarsRepo {
  /** Insert at settle. Caller wraps with run.bumpProgress in a TX. */
  insert(row: NewRoundAvatarRow): Promise<void>;
  /** Bulk insert variant — write all per-avatar rows for a round at once. */
  insertMany(rows: NewRoundAvatarRow[]): Promise<void>;
  /** All rows for a run, ordered (round_index asc, avatar_id). Dashboard read. */
  byRunId(runId: string): Promise<RoundAvatarRow[]>;
  /** Per-avatar timeseries for the drilldown morale chart. */
  byAvatar(runId: string, avatarId: string): Promise<RoundAvatarRow[]>;
}

export function createRoundAvatarsRepo(db: DB): RoundAvatarsRepo {
  return {
    async insert(row) {
      db.insert(roundAvatar).values(row).run();
    },
    async insertMany(rows) {
      if (rows.length === 0) return;
      db.insert(roundAvatar).values(rows).run();
    },
    async byRunId(runId) {
      return db
        .select()
        .from(roundAvatar)
        .where(eq(roundAvatar.runId, runId))
        .orderBy(asc(roundAvatar.roundIndex))
        .all();
    },
    async byAvatar(runId, avatarId) {
      return db
        .select()
        .from(roundAvatar)
        .where(
          and(
            eq(roundAvatar.runId, runId),
            eq(roundAvatar.avatarId, avatarId),
          ),
        )
        .orderBy(asc(roundAvatar.roundIndex))
        .all();
    },
  };
}

// ─── Interactions repository ────────────────────────────────────────────────

export interface InteractionsRepo {
  /** Streamed mid-round so live drilldown can see them. */
  insert(row: NewInteractionRow): Promise<void>;
  /**
   * All interactions where avatarId was either initiator or responder,
   * ordered by (round_index asc, order_in_round asc). Drives the per-avatar
   * feed in the drilldown route.
   */
  byAvatar(runId: string, avatarId: string): Promise<InteractionRow[]>;
  /**
   * Subject + partner filter: returns interactions in either direction of
   * the unordered pair (subject↔partner). Powers `?partner=` on drilldown.
   */
  byPair(
    runId: string,
    avatarA: string,
    avatarB: string,
  ): Promise<InteractionRow[]>;
}

export function createInteractionsRepo(db: DB): InteractionsRepo {
  return {
    async insert(row) {
      db.insert(interaction).values(row).run();
    },
    async byAvatar(runId, avatarId) {
      return db
        .select()
        .from(interaction)
        .where(
          and(
            eq(interaction.runId, runId),
            or(
              eq(interaction.initiatorAvatarId, avatarId),
              eq(interaction.responderAvatarId, avatarId),
            ),
          ),
        )
        .orderBy(asc(interaction.roundIndex), asc(interaction.orderInRound))
        .all();
    },
    async byPair(runId, avatarA, avatarB) {
      return db
        .select()
        .from(interaction)
        .where(
          and(
            eq(interaction.runId, runId),
            or(
              and(
                eq(interaction.initiatorAvatarId, avatarA),
                eq(interaction.responderAvatarId, avatarB),
              ),
              and(
                eq(interaction.initiatorAvatarId, avatarB),
                eq(interaction.responderAvatarId, avatarA),
              ),
            ),
          ),
        )
        .orderBy(asc(interaction.roundIndex), asc(interaction.orderInRound))
        .all();
    },
  };
}

// ─── AppDb bundle ───────────────────────────────────────────────────────────

/**
 * Bundle the DB client + repos so the rest of the app can pass one object
 * around. The runner needs all five repos plus a transaction primitive;
 * route handlers mostly need the read sides.
 */
export interface AppDb {
  client: DB;
  runs: RunsRepo;
  avatars: AvatarsRepo;
  rounds: RoundsRepo;
  roundAvatars: RoundAvatarsRepo;
  interactions: InteractionsRepo;

  /**
   * Run a function inside a transaction. Used by the runner during settle to
   * atomically write all round_avatar rows + bump run progress counters.
   */
  transaction<T>(fn: (tx: AppDb) => Promise<T>): Promise<T>;
}

export function createAppDb(url?: string): AppDb {
  const client = createDb(url);
  return buildAppDb(client);
}

function buildAppDb(client: DB): AppDb {
  const bundle: AppDb = {
    client,
    runs: createRunsRepo(client),
    avatars: createAvatarsRepo(client),
    rounds: createRoundsRepo(client),
    roundAvatars: createRoundAvatarsRepo(client),
    interactions: createInteractionsRepo(client),
    transaction<T>(fn: (tx: AppDb) => Promise<T>): Promise<T> {
      // better-sqlite3 transactions are synchronous; drizzle's `.transaction`
      // wraps that. The repo methods are async-shaped but their underlying
      // DB calls are sync, so awaiting inside the callback resolves on the
      // same tick and the transaction commits correctly.
      return client.transaction((tx) => {
        const txClient = tx as unknown as DB;
        const txBundle: AppDb = {
          client: txClient,
          runs: createRunsRepo(txClient),
          avatars: createAvatarsRepo(txClient),
          rounds: createRoundsRepo(txClient),
          roundAvatars: createRoundAvatarsRepo(txClient),
          interactions: createInteractionsRepo(txClient),
          transaction: () => {
            throw new Error('nested transactions are not supported');
          },
        };
        return fn(txBundle);
      }) as Promise<T>;
    },
  };
  return bundle;
}
