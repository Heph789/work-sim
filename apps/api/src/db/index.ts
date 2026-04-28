// DB client + small per-table repository helpers. Repos exist so the runner
// and the route handlers don't pepper themselves with raw Drizzle calls — and
// so future migrations to a different driver are localized.
//
// Concurrency: better-sqlite3 is synchronous; one writer at a time is safe
// for a single-process prototype. The runner is the only writer of `rounds`
// and the only writer of `runs.rounds_completed` / `paper_total`.

// DEPENDENCY: better-sqlite3
import Database from 'better-sqlite3';
// DEPENDENCY: drizzle-orm
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc, lt, asc } from 'drizzle-orm';

import {
  runs,
  rounds,
  type RunRow,
  type NewRunRow,
  type RoundRow,
  type NewRoundRow,
} from './schema.js';

/**
 * The Drizzle database type the rest of the app sees. Exporting it lets
 * tests / fakes type-check against the same shape.
 */
export type DB = BetterSQLite3Database<{
  runs: typeof runs;
  rounds: typeof rounds;
}>;

/**
 * Construct the DB client. Called once from index.ts at boot. Enables WAL
 * journal mode so polling reads don't block while the runner writes.
 *
 * @param url Path to the SQLite file. Defaults to ./work-sim.db.
 */
export function createDb(url: string = './work-sim.db'): DB {
  // TODO:
  //   const sqlite = new Database(url);
  //   sqlite.pragma('journal_mode = WAL');
  //   sqlite.pragma('foreign_keys = ON');
  //   return drizzle(sqlite, { schema: { runs, rounds } });
  void url;
  void Database;
  void drizzle;
  throw new Error('createDb: not implemented');
}

// ── Runs repository ─────────────────────────────────────────────────────────
// Centralizes the small set of mutations the runner / API perform. Anything
// that touches the runs row should go through here.

export interface RunsRepo {
  /** Insert a new run. Used by POST /runs. Status is 'pending' on insert. */
  insert(row: NewRunRow): Promise<void>;

  /** Load a single run by id; returns undefined if missing. */
  byId(id: string): Promise<RunRow | undefined>;

  /** List runs newest-first. Used by GET /runs. */
  list(opts: { limit: number; cursor: number | null }): Promise<RunRow[]>;

  /** Status setter. Used by the runner for state-machine transitions. */
  setStatus(id: string, status: RunRow['status']): Promise<void>;

  /** Atomic bump after a successful round write — must run inside a TX. */
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

/** Construct the runs repo on top of a Drizzle client. */
export function createRunsRepo(db: DB): RunsRepo {
  return {
    async insert(row) {
      // TODO: await db.insert(runs).values(row);
      void row;
      throw new Error('runs.insert: not implemented');
    },

    async byId(id) {
      // TODO:
      //   const [r] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
      //   return r;
      void id;
      void eq;
      throw new Error('runs.byId: not implemented');
    },

    async list({ limit, cursor }) {
      // TODO: ORDER BY created_at DESC; if cursor set, WHERE created_at < cursor.
      void limit;
      void cursor;
      void desc;
      void lt;
      throw new Error('runs.list: not implemented');
    },

    async setStatus(id, status) {
      // TODO: await db.update(runs).set({ status }).where(eq(runs.id, id));
      void id;
      void status;
      throw new Error('runs.setStatus: not implemented');
    },

    async bumpProgress(id, roundsCompleted, paperSoldDelta) {
      // TODO: increment rounds_completed and paper_total in one UPDATE.
      // Use a SQL expression so the increment is atomic at the DB level:
      //   UPDATE runs SET rounds_completed = ?, paper_total = paper_total + ?
      //   WHERE id = ?
      void id;
      void roundsCompleted;
      void paperSoldDelta;
      throw new Error('runs.bumpProgress: not implemented');
    },

    async setFailed(id, args) {
      // TODO: UPDATE runs SET status='failed', error_message=?, failed_at_round=? WHERE id=?
      void id;
      void args;
      throw new Error('runs.setFailed: not implemented');
    },
  };
}

// ── Rounds repository ───────────────────────────────────────────────────────

export interface RoundsRepo {
  /** Append a completed round. Caller wraps with bumpProgress in a TX. */
  insert(row: NewRoundRow): Promise<void>;

  /** All rounds for a run, ordered by round_index ascending. */
  byRunId(runId: string): Promise<RoundRow[]>;
}

export function createRoundsRepo(db: DB): RoundsRepo {
  return {
    async insert(row) {
      // TODO: await db.insert(rounds).values(row);
      void row;
      throw new Error('rounds.insert: not implemented');
    },

    async byRunId(runId) {
      // TODO:
      //   return db.select().from(rounds)
      //     .where(eq(rounds.runId, runId))
      //     .orderBy(asc(rounds.roundIndex));
      void runId;
      void asc;
      throw new Error('rounds.byRunId: not implemented');
    },
  };
}

/**
 * Bundle the DB client + repos so the rest of the app can pass one object
 * around. The runner needs access to both repos and to a transaction
 * primitive; route handlers mostly just need the repos.
 */
export interface AppDb {
  client: DB;
  runs: RunsRepo;
  rounds: RoundsRepo;

  /**
   * Run a function inside a transaction. Used by the runner to atomically
   * insert a round + bump the run's progress counters.
   */
  transaction<T>(fn: (tx: AppDb) => Promise<T>): Promise<T>;
}

/** Factory that builds the bundle from a fresh DB client. */
export function createAppDb(url?: string): AppDb {
  // TODO: const client = createDb(url); return { client, runs: createRunsRepo(client), ... };
  void url;
  throw new Error('createAppDb: not implemented');
}
