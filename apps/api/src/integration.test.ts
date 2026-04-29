// End-to-end integration test. Boots an in-memory SQLite DB, applies the
// canonical DDL, drives the Runner with a stub LLMClient, and verifies that
// every layer (DB writes, settle TX, route shapers) produces the expected
// shapes. This is the catch-net for schema drift, prompt builder runtime
// errors, and dashboard/drilldown wire-shape regressions.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { v4 as uuid } from 'uuid';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';

import {
  type AvatarTurn,
  type LLMCallOptions,
  type LLMClient,
  type Message,
  type RunConfig,
} from '@work-sim/shared';

import * as schema from './db/schema.js';
import {
  createAvatarsRepo,
  createInteractionsRepo,
  createRoundAvatarsRepo,
  createRoundsRepo,
  createRunsRepo,
  type AppDb,
  type DB,
} from './db/index.js';
import { Runner, SIM_ENGINE_VERSION } from './engine/runner.js';
import { PROMPT_TEMPLATE_VERSION } from './engine/prompts.js';
import {
  signedDelta,
  teamExpected,
  workerExpectedShare,
} from './engine/scoring.js';
import { toAvatarDetail, toRunDetail } from './routes/schemas.js';

/**
 * Stub LLM client. Records every call and returns deterministic canned
 * outputs so the runner exercises the full code path without network IO.
 *
 * - `complete` (manager free-text) returns a context-aware short line.
 * - `completeStructured` returns an AvatarTurn with a deterministic
 *   morale/self_perception/rationale derived from the call index. Per the
 *   AvatarTurnSchema spec, all four fields are present and within bounds.
 */
function makeStubLLM(): LLMClient & {
  callLog: Array<{ kind: 'complete' | 'completeStructured'; lastUserSnippet: string }>;
} {
  let structuredCallIndex = 0;
  const callLog: Array<{
    kind: 'complete' | 'completeStructured';
    lastUserSnippet: string;
  }> = [];

  return {
    callLog,

    async complete(messages: Message[], _opts: LLMCallOptions): Promise<string> {
      const last = messages[messages.length - 1]?.content ?? '';
      callLog.push({ kind: 'complete', lastUserSnippet: last.slice(0, 60) });
      // Manager 1:1 free-text. Keep it short and in-character-ish.
      return 'How are things going today? Anything you want to flag?';
    },

    async completeStructured<T>(
      messages: Message[],
      schemaArg: z.ZodSchema<T>,
      _name: string,
      _opts: LLMCallOptions,
    ): Promise<T> {
      const last = messages[messages.length - 1]?.content ?? '';
      callLog.push({
        kind: 'completeStructured',
        lastUserSnippet: last.slice(0, 60),
      });

      // Cycle morale across a wide range so the dashboard aggregations have
      // something interesting to verify.
      const moraleStops = [55, 62, 48, 70, 40, 58, 65];
      const morale = moraleStops[structuredCallIndex % moraleStops.length]!;
      structuredCallIndex++;

      const turn: AvatarTurn = {
        message: 'Sounds good — I am keeping at it.',
        updated_self_perception:
          'I feel steady; the manager seems engaged but the day is busy.',
        morale,
        morale_rationale: 'Mixed signals from the day so far.',
      };
      // Re-validate so any schema mismatch surfaces in the test.
      return schemaArg.parse(turn);
    },
  };
}

function bootInMemoryDb(): AppDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const ddl = readFileSync(
    resolve(__dirname, '../../../docs/tmp/many-workers-backend/schema.sql'),
    'utf8',
  );
  sqlite.exec(ddl);

  const client = drizzle(sqlite, {
    schema: {
      run: schema.run,
      avatar: schema.avatar,
      round: schema.round,
      roundAvatar: schema.roundAvatar,
      interaction: schema.interaction,
    },
  }) as unknown as DB;

  const bundle: AppDb = {
    client,
    runs: createRunsRepo(client),
    avatars: createAvatarsRepo(client),
    rounds: createRoundsRepo(client),
    roundAvatars: createRoundAvatarsRepo(client),
    interactions: createInteractionsRepo(client),
    transaction(fn) {
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
            throw new Error('nested tx unsupported');
          },
        };
        return fn(txBundle);
      }) as Promise<ReturnType<typeof fn>>;
    },
  };
  return bundle;
}

async function seedRun(
  db: AppDb,
  args: { runId: string; numWorkers: number; rounds: number },
): Promise<{ managerId: string; workerIds: string[]; config: RunConfig }> {
  const managerId = uuid();
  const workerIds = Array.from({ length: args.numWorkers }, () => uuid());

  const avatars = [
    {
      id: managerId,
      role_in_sim: 'manager' as const,
      name: 'Michael',
      role_label: 'Regional Manager',
      personality: 'mgr',
      values: 'mgr-values',
      baseline_output: 0,
    },
    ...workerIds.map((id, i) => ({
      id,
      role_in_sim: 'worker' as const,
      name: ['Jim', 'Pam', 'Dwight'][i] ?? `Worker${i}`,
      role_label: 'Sales Rep',
      personality: 'p',
      values: 'v',
      baseline_output: [14, 9, 18][i] ?? 10,
    })),
  ];

  const config: RunConfig = {
    avatars,
    model: 'stub-model',
    temperature: 0.8,
    top_p: 1.0,
    prompt_template_version: PROMPT_TEMPLATE_VERSION,
    situation_tag_seed: 42,
    sim_engine_version: SIM_ENGINE_VERSION,
  };

  await db.runs.insert({
    id: args.runId,
    createdAt: Date.now(),
    status: 'pending',
    roundsTotal: args.rounds,
    roundsCompleted: 0,
    targetPaper: 100,
    paperTotal: 0,
    experimentId: null,
    configJson: JSON.stringify(config),
    errorMessage: null,
    failedAtRound: null,
  });
  await db.avatars.insertMany(
    avatars.map((a) => ({
      id: a.id,
      runId: args.runId,
      roleInSim: a.role_in_sim,
      name: a.name,
      roleLabel: a.role_label,
      personality: a.personality,
      values: a.values,
      baselineOutput: a.baseline_output,
    })),
  );

  return { managerId, workerIds, config };
}

describe('runner integration (in-memory DB + stub LLM)', () => {
  it('drives a 2-round / 3-worker run end-to-end and produces a coherent dashboard', async () => {
    const db = bootInMemoryDb();
    const llm = makeStubLLM();
    const runner = new Runner(llm, db);

    const runId = uuid();
    const { managerId, workerIds } = await seedRun(db, {
      runId,
      numWorkers: 3,
      rounds: 2,
    });

    await runner.run(runId);

    // Run status: completed.
    const finalRun = await db.runs.byId(runId);
    expect(finalRun?.status).toBe('completed');
    expect(finalRun?.roundsCompleted).toBe(2);

    // Per-round structure: 2 round rows.
    const rounds = await db.rounds.byRunId(runId);
    expect(rounds.map((r) => r.roundIndex)).toEqual([1, 2]);

    // Interaction count: per round, N manager 1:1s + N peer pairs (K=N).
    // 3 workers × 2 phases × 2 rounds = 12 interactions.
    const allInteractions = await db.interactions.byAvatar(runId, managerId);
    expect(allInteractions).toHaveLength(2 * 3); // manager appears in 6 1:1s
    // Peer interactions don't include the manager — count via worker[0].
    const w0Interactions = await db.interactions.byAvatar(runId, workerIds[0]!);
    // Each round: 1 manager 1:1 + appears in some peer pairs (depends on
    // sampling). Verify *every* w0 interaction belongs to round 1 or 2 and
    // has order_in_round in [0, 5].
    for (const it of w0Interactions) {
      expect([1, 2]).toContain(it.roundIndex);
      expect(it.orderInRound).toBeGreaterThanOrEqual(0);
      expect(it.orderInRound).toBeLessThan(6);
    }

    // order_in_round is unique per round.
    const r1Interactions = w0Interactions.filter((i) => i.roundIndex === 1);
    const r1Orders = new Set(r1Interactions.map((i) => i.orderInRound));
    expect(r1Orders.size).toBe(r1Interactions.length);

    // Manager-side morale fields are NULL on manager 1:1 rows.
    const managerLed = w0Interactions.filter(
      (i) => i.initiatorAvatarId === managerId,
    );
    for (const it of managerLed) {
      expect(it.initiatorMorale).toBeNull();
      expect(it.initiatorMoraleRationale).toBeNull();
      expect(it.initiatorSelfPerception).toBeNull();
      expect(typeof it.responderMorale).toBe('number');
      expect(it.responderSelfPerception).not.toBeNull();
    }

    // round_avatar: every round writes one row per avatar (3 workers + 1 mgr).
    const allRoundAvatars = await db.roundAvatars.byRunId(runId);
    expect(allRoundAvatars).toHaveLength(2 * 4);
    const managerRA = allRoundAvatars.filter((r) => r.avatarId === managerId);
    expect(managerRA).toHaveLength(2);
    for (const r of managerRA) {
      expect(r.morale).toBeNull();
      expect(r.paperSold).toBeNull();
    }

    // Run-level paper total = sum of worker paper_sold across all rounds.
    const workerRA = allRoundAvatars.filter((r) =>
      workerIds.includes(r.avatarId),
    );
    const expectedPaperTotal = workerRA.reduce(
      (s, r) => s + (r.paperSold ?? 0),
      0,
    );
    expect(finalRun?.paperTotal).toBe(expectedPaperTotal);

    // Dashboard shape via toRunDetail.
    const avatars = await db.avatars.byRunId(runId);
    const detail = toRunDetail({
      run: finalRun!,
      avatars,
      rounds,
      roundAvatars: allRoundAvatars,
      helpers: { teamExpected, workerExpectedShare, signedDelta },
    });
    expect(detail.status).toBe('completed');
    expect(detail.rounds).toHaveLength(2);
    expect(detail.per_avatar).toHaveLength(4);
    const dashboardManager = detail.per_avatar.find(
      (p) => p.avatar_id === managerId,
    )!;
    expect(dashboardManager.paper_total).toBeNull();
    expect(dashboardManager.last_morale).toBeNull();
    const dashboardWorker = detail.per_avatar.find(
      (p) => p.avatar_id === workerIds[0],
    )!;
    expect(dashboardWorker.morale_curve).toHaveLength(2);
    expect(dashboardWorker.morale_curve[0]).not.toBeNull();
    expect(dashboardWorker.paper_total).toBeGreaterThanOrEqual(0);
    // situation_tag_seed must NOT be in the public config.
    expect(
      'situation_tag_seed' in (detail.config as Record<string, unknown>),
    ).toBe(false);

    // Drilldown shape via toAvatarDetail (worker 0).
    const subjectRoundAvatars = await db.roundAvatars.byAvatar(
      runId,
      workerIds[0]!,
    );
    const w0FullInteractions = await db.interactions.byAvatar(
      runId,
      workerIds[0]!,
    );
    const avatarsById = new Map(avatars.map((a) => [a.id, a]));
    const drill = toAvatarDetail({
      subject: avatars.find((a) => a.id === workerIds[0])!,
      partner: null,
      subjectRoundAvatars,
      interactions: w0FullInteractions,
      avatarsById,
      rounds,
    });
    expect(drill.rounds).toHaveLength(2);
    for (const r of drill.rounds) {
      expect(r.situation_tag).not.toBe('');
      expect(r.self_perception).not.toBeNull();
    }
    // self_perception fields are stripped from interaction shapes.
    for (const it of drill.interactions) {
      expect(
        'initiator_self_perception' in (it as Record<string, unknown>),
      ).toBe(false);
      expect(
        'responder_self_perception' in (it as Record<string, unknown>),
      ).toBe(false);
    }

    // LLM call count: per round = 2N (manager 1:1 = 1 free + 1 structured) + 2K (peer = 2 structured each).
    // Free-text: N per round = 6 total. Structured: N + 2K = 9 per round = 18 total.
    const completeCalls = llm.callLog.filter((c) => c.kind === 'complete');
    const structuredCalls = llm.callLog.filter(
      (c) => c.kind === 'completeStructured',
    );
    expect(completeCalls).toHaveLength(2 * 3); // 1 per worker × 2 rounds
    expect(structuredCalls).toHaveLength(2 * (3 + 2 * 3)); // worker 1:1 + 2*K peer per round
  });

  it('peer phase is skipped cleanly when there is only one worker', async () => {
    const db = bootInMemoryDb();
    const llm = makeStubLLM();
    const runner = new Runner(llm, db);

    const runId = uuid();
    await seedRun(db, { runId, numWorkers: 1, rounds: 2 });
    await runner.run(runId);

    const finalRun = await db.runs.byId(runId);
    expect(finalRun?.status).toBe('completed');

    // 1 manager 1:1 + 0 peer = 1 interaction per round, 2 total.
    const allRoundAvatars = await db.roundAvatars.byRunId(runId);
    const someAvatarId = allRoundAvatars[0]!.avatarId;
    const interactions = await db.interactions.byAvatar(runId, someAvatarId);
    expect(interactions.length).toBeLessThanOrEqual(2);

    // Only structured calls = worker 1:1 (1 per round) — no peers.
    const structured = llm.callLog.filter(
      (c) => c.kind === 'completeStructured',
    );
    expect(structured).toHaveLength(2);
  });

  it('persists run as failed with failed_at_round when the LLM throws mid-run', async () => {
    const db = bootInMemoryDb();
    let calls = 0;
    const flakyLlm: LLMClient = {
      async complete(): Promise<string> {
        calls++;
        if (calls > 2) throw new Error('llm exploded');
        return 'hi';
      },
      async completeStructured<T>(
        _m: Message[],
        schemaArg: z.ZodSchema<T>,
      ): Promise<T> {
        return schemaArg.parse({
          message: 'ok',
          updated_self_perception: 'sp',
          morale: 50,
          morale_rationale: 'fine',
        });
      },
    };
    const runner = new Runner(flakyLlm, db);

    const runId = uuid();
    await seedRun(db, { runId, numWorkers: 2, rounds: 3 });
    await runner.run(runId);

    const finalRun = await db.runs.byId(runId);
    expect(finalRun?.status).toBe('failed');
    expect(finalRun?.errorMessage).toContain('llm exploded');
    expect(finalRun?.failedAtRound).toBeGreaterThanOrEqual(1);
  });
});
