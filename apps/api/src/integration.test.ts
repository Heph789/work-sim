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
 * - `completeStructured` is called against three different schemas in this
 *   iteration (OpeningTurn / ReactionTurn / InitiatorReflection). We return
 *   a superset object containing every field any of the schemas needs;
 *   zod's default object parsing strips unknown keys per schema so the same
 *   value satisfies all three.
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

      // Cycle deltas across the [-10, +10] range so dashboard aggregations
      // see meaningful morale movement.
      const deltaStops = [+5, +2, -3, +7, -6, +4, -1];
      const morale_delta =
        deltaStops[structuredCallIndex % deltaStops.length]!;
      structuredCallIndex++;

      // Superset shape; zod strips unknown keys per the active schema.
      const turn = {
        message: 'Sounds good — I am keeping at it.',
        updated_self_perception:
          'I feel steady; the manager seems engaged but the day is busy.',
        morale_delta,
        morale_rationale: 'Mixed signals from the day so far.',
      };
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

    const finalRun = await db.runs.byId(runId);
    expect(finalRun?.status).toBe('completed');
    expect(finalRun?.roundsCompleted).toBe(2);

    const rounds = await db.rounds.byRunId(runId);
    expect(rounds.map((r) => r.roundIndex)).toEqual([1, 2]);

    const allInteractions = await db.interactions.byAvatar(runId, managerId);
    expect(allInteractions).toHaveLength(2 * 3); // manager appears in 6 1:1s
    const w0Interactions = await db.interactions.byAvatar(runId, workerIds[0]!);
    for (const it of w0Interactions) {
      expect([1, 2]).toContain(it.roundIndex);
      expect(it.orderInRound).toBeGreaterThanOrEqual(0);
      expect(it.orderInRound).toBeLessThan(6);
    }

    const r1Interactions = w0Interactions.filter((i) => i.roundIndex === 1);
    const r1Orders = new Set(r1Interactions.map((i) => i.orderInRound));
    expect(r1Orders.size).toBe(r1Interactions.length);

    // Manager-side delta fields are NULL on manager 1:1 rows; responder
    // (worker) emitted a signed delta.
    const managerLed = w0Interactions.filter(
      (i) => i.initiatorAvatarId === managerId,
    );
    for (const it of managerLed) {
      expect(it.initiatorMoraleDelta).toBeNull();
      expect(it.initiatorMoraleRationale).toBeNull();
      expect(it.initiatorSelfPerception).toBeNull();
      expect(typeof it.responderMoraleDelta).toBe('number');
      expect(it.responderMoraleDelta).toBeGreaterThanOrEqual(-10);
      expect(it.responderMoraleDelta).toBeLessThanOrEqual(10);
      expect(it.responderSelfPerception).not.toBeNull();
    }

    // Peer rows have BOTH sides populated — the initiator emitted a delta in
    // their reflection (call 2 after seeing the reply).
    const peerRows = w0Interactions.filter(
      (i) => i.initiatorAvatarId !== managerId,
    );
    for (const it of peerRows) {
      expect(typeof it.initiatorMoraleDelta).toBe('number');
      expect(it.initiatorMoraleRationale).not.toBeNull();
      expect(it.initiatorSelfPerception).not.toBeNull();
      expect(typeof it.responderMoraleDelta).toBe('number');
    }

    // round_avatar.morale stays as the running absolute total in [0, 100].
    const allRoundAvatars = await db.roundAvatars.byRunId(runId);
    expect(allRoundAvatars).toHaveLength(2 * 4);
    const managerRA = allRoundAvatars.filter((r) => r.avatarId === managerId);
    expect(managerRA).toHaveLength(2);
    for (const r of managerRA) {
      expect(r.morale).toBeNull();
      expect(r.paperSold).toBeNull();
    }
    for (const r of allRoundAvatars) {
      if (r.morale !== null) {
        expect(r.morale).toBeGreaterThanOrEqual(0);
        expect(r.morale).toBeLessThanOrEqual(100);
      }
    }

    const workerRA = allRoundAvatars.filter((r) =>
      workerIds.includes(r.avatarId),
    );
    const expectedPaperTotal = workerRA.reduce(
      (s, r) => s + (r.paperSold ?? 0),
      0,
    );
    expect(finalRun?.paperTotal).toBe(expectedPaperTotal);

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
    expect(
      'situation_tag_seed' in (detail.config as Record<string, unknown>),
    ).toBe(false);

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
    for (const it of drill.interactions) {
      // The wire shape has only `subject_self_perception` — the symmetric
      // initiator/responder self_perception fields stay in the DB.
      expect(
        'initiator_self_perception' in (it as Record<string, unknown>),
      ).toBe(false);
      expect(
        'responder_self_perception' in (it as Record<string, unknown>),
      ).toBe(false);
      // Subject is workerIds[0], who is either initiator or responder on
      // every interaction in their feed, and emits a self_perception every
      // turn → the field must be non-null.
      expect(it.subject_self_perception).not.toBeNull();
    }

    // LLM call count per round (N=K=3):
    //   - Manager free-text: N
    //   - Worker 1:1 ReactionTurn: N
    //   - Peer per pair: 1 OpeningTurn + 1 ReactionTurn + 1 InitiatorReflection = 3K
    // Total per round: N free + (N + 3K) structured.
    // For 2 rounds: free = 2N = 6, structured = 2(N + 3K) = 24.
    const completeCalls = llm.callLog.filter((c) => c.kind === 'complete');
    const structuredCalls = llm.callLog.filter(
      (c) => c.kind === 'completeStructured',
    );
    expect(completeCalls).toHaveLength(2 * 3);
    expect(structuredCalls).toHaveLength(2 * (3 + 3 * 3));
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

    const allRoundAvatars = await db.roundAvatars.byRunId(runId);
    const someAvatarId = allRoundAvatars[0]!.avatarId;
    const interactions = await db.interactions.byAvatar(runId, someAvatarId);
    expect(interactions.length).toBeLessThanOrEqual(2);

    // Only structured calls = worker 1:1 ReactionTurn (1 per round) — no peers.
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
          morale_delta: 0,
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
