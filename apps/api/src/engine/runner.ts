// The Runner. Owns the per-round loop, the run status state machine, and
// the discipline of "stream interactions live, settle the round in a
// transaction." Per docs/many-workers/simulation-engine.md.

import { v4 as uuid } from 'uuid';

import type { LLMClient } from '@work-sim/shared';
import {
  OpeningTurnSchema,
  ReactionTurnSchema,
  InitiatorReflectionSchema,
  type AvatarProfile,
  type OpeningTurn,
  type ReactionTurn,
  type InitiatorReflection,
  type RunConfig,
} from '@work-sim/shared';
import {
  pickTag,
  samplePairs,
  orientPair,
  type SituationTagId,
} from '@work-sim/shared';

import type { AppDb } from '../db/index.js';
import type { AvatarRow, InteractionRow, NewInteractionRow } from '../db/schema.js';
import {
  applyMoraleDelta,
  paperSold,
  signedDelta,
  teamExpected,
  workerExpectedShare,
  MANAGER_DELTA_WEIGHT,
} from './scoring.js';
import {
  buildManagerPrompt,
  buildPeerInitiatorOpeningPrompt,
  buildPeerInitiatorReflectionPrompt,
  buildPeerResponderPrompt,
  buildWorker1on1Prompt,
  INITIAL_SELF_PERCEPTION,
  PROMPT_TEMPLATE_VERSION,
} from './prompts.js';

void PROMPT_TEMPLATE_VERSION;

/**
 * Bumped whenever the runner / scoring logic changes meaningfully. Captured
 * in config_json so historical runs are tied to the engine version that
 * produced them — necessary for reproducibility.
 */
export const SIM_ENGINE_VERSION = 'v3';

/**
 * Worker's running internal state. Morale is the absolute 0..100 running
 * total accumulated from weighted deltas; moraleRationale holds the most
 * recent delta's rationale (surfaced on round_avatar.morale_rationale).
 */
interface WorkerState {
  selfPerception: string;
  morale: number;
  moraleRationale: string;
}

export class Runner {
  constructor(
    private llm: LLMClient,
    private db: AppDb,
  ) {}

  async run(runId: string): Promise<void> {
    const runRow = await this.db.runs.byId(runId);
    if (!runRow) throw new Error(`run ${runId} not found`);

    const config = JSON.parse(runRow.configJson) as RunConfig;
    const avatars = await this.db.avatars.byRunId(runId);
    const manager = avatars.find((a) => a.roleInSim === 'manager');
    const workers = avatars.filter((a) => a.roleInSim === 'worker');
    if (!manager) {
      throw new Error(`run ${runId} has no manager avatar`);
    }

    await this.db.runs.setStatus(runId, 'running');

    const workerState = new Map<string, WorkerState>(
      workers.map((w) => [
        w.id,
        {
          selfPerception: INITIAL_SELF_PERCEPTION,
          morale: 50,
          moraleRationale: '',
        },
      ]),
    );

    const avatarsById = new Map<string, AvatarRow>(
      avatars.map((a) => [a.id, a]),
    );

    // Per-worker cumulative paper sold across completed rounds. Updated at
    // settle and fed back into the manager prompt next round.
    const workerPaperTotals = new Map<string, number>(
      workers.map((w) => [w.id, 0]),
    );

    let currentRound = 0;
    try {
      for (let i = 1; i <= runRow.roundsTotal; i++) {
        currentRound = i;

        const fresh = await this.db.runs.byId(runId);
        if (!fresh || fresh.status !== 'running') return;

        await this.runRound({
          runId,
          config,
          manager,
          workers,
          avatarsById,
          workerState,
          workerPaperTotals,
          roundIndex: i,
          targetPaper: fresh.targetPaper,
          paperTotalAtRoundStart: fresh.paperTotal,
          roundsCompletedAtRoundStart: fresh.roundsCompleted,
          roundsTotal: fresh.roundsTotal,
        });
      }

      await this.db.runs.setStatus(runId, 'completed');
    } catch (err) {
      await this.db.runs.setFailed(runId, {
        errorMessage: err instanceof Error ? err.message : String(err),
        failedAtRound: currentRound,
      });
    }
  }

  private async runRound(args: {
    runId: string;
    config: RunConfig;
    manager: AvatarRow;
    workers: AvatarRow[];
    avatarsById: ReadonlyMap<string, AvatarRow>;
    workerState: Map<string, WorkerState>;
    workerPaperTotals: Map<string, number>;
    roundIndex: number;
    targetPaper: number;
    paperTotalAtRoundStart: number;
    roundsCompletedAtRoundStart: number;
    roundsTotal: number;
  }): Promise<void> {
    const {
      runId,
      config,
      manager,
      workers,
      avatarsById,
      workerState,
      workerPaperTotals,
      roundIndex,
      targetPaper,
      paperTotalAtRoundStart,
      roundsCompletedAtRoundStart,
      roundsTotal,
    } = args;

    const situationTag = pickTag(config.situation_tag_seed, roundIndex);

    const roundId = uuid();
    await this.db.rounds.insert({
      id: roundId,
      runId,
      roundIndex,
      situationTag,
      createdAt: Date.now(),
    });

    const priorInteractions = await this.db.interactions.byAvatar(
      runId,
      manager.id,
    );
    const interactionsThisRound: InteractionRow[] = [];

    let order = 0;

    order = await this.runManagerPhase({
      runId,
      roundId,
      roundIndex,
      situationTag,
      config,
      manager,
      workers,
      avatarsById,
      workerState,
      workerPaperTotals,
      targetPaper,
      paperTotalAtRoundStart,
      roundsCompletedAtRoundStart,
      roundsTotal,
      priorInteractions,
      interactionsThisRound,
      orderStart: order,
    });

    const priorPeerInteractions = await this.loadPriorPeerInteractions(
      runId,
      workers,
    );

    order = await this.runPeerPhase({
      runId,
      roundId,
      roundIndex,
      situationTag,
      config,
      workers,
      avatarsById,
      workerState,
      priorPeerInteractions,
      interactionsThisRound,
      orderStart: order,
    });

    void order;

    await this.settle({
      runId,
      roundId,
      roundIndex,
      manager,
      workers,
      workerState,
      workerPaperTotals,
    });
  }

  private async runManagerPhase(args: {
    runId: string;
    roundId: string;
    roundIndex: number;
    situationTag: SituationTagId;
    config: RunConfig;
    manager: AvatarRow;
    workers: AvatarRow[];
    avatarsById: ReadonlyMap<string, AvatarRow>;
    workerState: Map<string, WorkerState>;
    workerPaperTotals: ReadonlyMap<string, number>;
    targetPaper: number;
    paperTotalAtRoundStart: number;
    roundsCompletedAtRoundStart: number;
    roundsTotal: number;
    priorInteractions: ReadonlyArray<InteractionRow>;
    interactionsThisRound: InteractionRow[];
    orderStart: number;
  }): Promise<number> {
    const {
      runId,
      roundId,
      roundIndex,
      situationTag,
      config,
      manager,
      workers,
      avatarsById,
      workerState,
      workerPaperTotals,
      targetPaper,
      paperTotalAtRoundStart,
      roundsCompletedAtRoundStart,
      roundsTotal,
      priorInteractions,
      interactionsThisRound,
    } = args;

    let order = args.orderStart;

    const teamExpectedNow = teamExpected({
      targetPaper,
      roundsCompleted: roundsCompletedAtRoundStart,
      roundsTotal,
    });
    const teamDelta = signedDelta(paperTotalAtRoundStart, teamExpectedNow);
    const numWorkers = workers.length;
    const roundsRemaining = roundsTotal - roundsCompletedAtRoundStart;

    const orderedWorkers = seededShuffle(
      workers,
      `${config.situation_tag_seed}:${roundIndex}:manager`,
    );

    for (const worker of orderedWorkers) {
      const managerProfile = profileFromRow(manager);
      const workerProfile = profileFromRow(worker);

      const priorMgrW = priorInteractions.filter((it) =>
        isPairInteraction(it, manager.id, worker.id),
      );

      const workerPaperTotal = workerPaperTotals.get(worker.id) ?? 0;
      const expectedShare = workerExpectedShare({
        targetPaper,
        numWorkers,
        roundsCompleted: roundsCompletedAtRoundStart,
        roundsTotal,
      });
      const workerDelta = signedDelta(workerPaperTotal, expectedShare);

      const managerMessages = buildManagerPrompt({
        manager: managerProfile,
        worker: workerProfile,
        situationTag,
        targetPaper,
        paperTotal: paperTotalAtRoundStart,
        teamExpected: teamExpectedNow,
        teamDelta,
        roundsRemaining,
        workerPaperTotal,
        workerExpectedShare: expectedShare,
        workerDelta,
        priorManagerWorkerInteractions: priorMgrW,
        avatarsById,
      });

      const managerMessage = await this.llm.complete(managerMessages, {
        model: config.model,
        temperature: config.temperature,
        topP: config.top_p,
      });

      const workerMessages = buildWorker1on1Prompt({
        worker: workerProfile,
        manager: managerProfile,
        situationTag,
        selfPerception: workerState.get(worker.id)!.selfPerception,
        managerMessage,
        todayInteractionsForWorker: interactionsThisRound,
        priorManagerWorkerInteractions: priorMgrW,
        avatarsById,
      });

      const workerTurn = await this.llm.completeStructured<ReactionTurn>(
        workerMessages,
        ReactionTurnSchema,
        'ReactionTurn',
        {
          model: config.model,
          temperature: config.temperature,
          topP: config.top_p,
        },
      );

      const row: NewInteractionRow = {
        id: uuid(),
        runId,
        roundId,
        roundIndex,
        orderInRound: order,
        situationTag,
        initiatorAvatarId: manager.id,
        responderAvatarId: worker.id,
        initiatorMessage: managerMessage,
        responderMessage: workerTurn.message,
        initiatorMoraleDelta: null,
        initiatorMoraleRationale: null,
        initiatorSelfPerception: null,
        responderMoraleDelta: workerTurn.morale_delta,
        responderMoraleRationale: workerTurn.morale_rationale,
        responderSelfPerception: workerTurn.updated_self_perception,
        createdAt: Date.now(),
      };
      await this.db.interactions.insert(row);
      interactionsThisRound.push(row as InteractionRow);

      const ws = workerState.get(worker.id)!;
      ws.selfPerception = workerTurn.updated_self_perception;
      ws.morale = applyMoraleDelta(
        ws.morale,
        workerTurn.morale_delta,
        MANAGER_DELTA_WEIGHT,
      );
      ws.moraleRationale = workerTurn.morale_rationale;

      order++;
    }

    return order;
  }

  private async runPeerPhase(args: {
    runId: string;
    roundId: string;
    roundIndex: number;
    situationTag: SituationTagId;
    config: RunConfig;
    workers: AvatarRow[];
    avatarsById: ReadonlyMap<string, AvatarRow>;
    workerState: Map<string, WorkerState>;
    priorPeerInteractions: ReadonlyArray<InteractionRow>;
    interactionsThisRound: InteractionRow[];
    orderStart: number;
  }): Promise<number> {
    const {
      runId,
      roundId,
      roundIndex,
      situationTag,
      config,
      workers,
      avatarsById,
      workerState,
      priorPeerInteractions,
      interactionsThisRound,
    } = args;

    let order = args.orderStart;

    const pairs = samplePairs(
      workers,
      workers.length,
      `${config.situation_tag_seed}:${roundIndex}:peer`,
    );

    for (const [a, b] of pairs) {
      const [initiator, responder] = orientPair(
        a,
        b,
        `${config.situation_tag_seed}:${roundIndex}:peer:${order}`,
      );

      const initiatorProfile = profileFromRow(initiator);
      const responderProfile = profileFromRow(responder);

      const pairHistory = priorPeerInteractions.filter((it) =>
        isPairInteraction(it, initiator.id, responder.id),
      );

      // ── Call 1: initiator opens with a message only ──────────────────
      const openingMessages = buildPeerInitiatorOpeningPrompt({
        self: initiatorProfile,
        partner: responderProfile,
        situationTag,
        selfPerception: workerState.get(initiator.id)!.selfPerception,
        todayInteractionsForSelf: interactionsThisRound,
        pairHistory,
        avatarsById,
      });

      const opening = await this.llm.completeStructured<OpeningTurn>(
        openingMessages,
        OpeningTurnSchema,
        'OpeningTurn',
        {
          model: config.model,
          temperature: config.temperature,
          topP: config.top_p,
        },
      );

      // ── Responder reacts: full ReactionTurn ──────────────────────────
      const responderMessages = buildPeerResponderPrompt({
        self: responderProfile,
        partner: initiatorProfile,
        situationTag,
        selfPerception: workerState.get(responder.id)!.selfPerception,
        todayInteractionsForSelf: interactionsThisRound,
        pairHistory,
        initiatorMessage: opening.message,
        avatarsById,
      });

      const responderTurn = await this.llm.completeStructured<ReactionTurn>(
        responderMessages,
        ReactionTurnSchema,
        'ReactionTurn',
        {
          model: config.model,
          temperature: config.temperature,
          topP: config.top_p,
        },
      );

      // ── Call 2: initiator reflects on the reply ──────────────────────
      const reflectionMessages = buildPeerInitiatorReflectionPrompt({
        self: initiatorProfile,
        partner: responderProfile,
        situationTag,
        selfPerception: workerState.get(initiator.id)!.selfPerception,
        todayInteractionsForSelf: interactionsThisRound,
        pairHistory,
        initiatorMessage: opening.message,
        responderMessage: responderTurn.message,
        avatarsById,
      });

      const reflection =
        await this.llm.completeStructured<InitiatorReflection>(
          reflectionMessages,
          InitiatorReflectionSchema,
          'InitiatorReflection',
          {
            model: config.model,
            temperature: config.temperature,
            topP: config.top_p,
          },
        );

      const row: NewInteractionRow = {
        id: uuid(),
        runId,
        roundId,
        roundIndex,
        orderInRound: order,
        situationTag,
        initiatorAvatarId: initiator.id,
        responderAvatarId: responder.id,
        initiatorMessage: opening.message,
        responderMessage: responderTurn.message,
        initiatorMoraleDelta: reflection.morale_delta,
        initiatorMoraleRationale: reflection.morale_rationale,
        initiatorSelfPerception: reflection.updated_self_perception,
        responderMoraleDelta: responderTurn.morale_delta,
        responderMoraleRationale: responderTurn.morale_rationale,
        responderSelfPerception: responderTurn.updated_self_perception,
        createdAt: Date.now(),
      };
      await this.db.interactions.insert(row);
      interactionsThisRound.push(row as InteractionRow);

      const initState = workerState.get(initiator.id)!;
      initState.selfPerception = reflection.updated_self_perception;
      initState.morale = applyMoraleDelta(
        initState.morale,
        reflection.morale_delta,
        1,
      );
      initState.moraleRationale = reflection.morale_rationale;

      const respState = workerState.get(responder.id)!;
      respState.selfPerception = responderTurn.updated_self_perception;
      respState.morale = applyMoraleDelta(
        respState.morale,
        responderTurn.morale_delta,
        1,
      );
      respState.moraleRationale = responderTurn.morale_rationale;

      order++;
    }

    return order;
  }

  private async settle(args: {
    runId: string;
    roundId: string;
    roundIndex: number;
    manager: AvatarRow;
    workers: AvatarRow[];
    workerState: Map<string, WorkerState>;
    workerPaperTotals: Map<string, number>;
  }): Promise<void> {
    const { runId, roundId, roundIndex, manager, workers, workerState, workerPaperTotals } =
      args;
    const now = Date.now();

    const workerRows = workers.map((w) => {
      const s = workerState.get(w.id)!;
      const sold = paperSold(w.baselineOutput, s.morale);
      return {
        id: uuid(),
        runId,
        roundId,
        roundIndex,
        avatarId: w.id,
        morale: s.morale,
        moraleRationale: s.moraleRationale,
        selfPerception: s.selfPerception,
        paperSold: sold,
        createdAt: now,
      };
    });
    const managerRow = {
      id: uuid(),
      runId,
      roundId,
      roundIndex,
      avatarId: manager.id,
      morale: null,
      moraleRationale: null,
      selfPerception: null,
      paperSold: null,
      createdAt: now,
    };
    const total = workerRows.reduce((s, r) => s + (r.paperSold ?? 0), 0);

    await this.db.transaction((tx) => {
      // Repo methods are sync underneath; do not await — drizzle rejects a
      // transaction callback that returns a Promise.
      void tx.roundAvatars.insertMany([...workerRows, managerRow]);
      void tx.runs.bumpProgress(runId, roundIndex, total);
    });

    for (const row of workerRows) {
      const prior = workerPaperTotals.get(row.avatarId) ?? 0;
      workerPaperTotals.set(row.avatarId, prior + (row.paperSold ?? 0));
    }
  }

  private async loadPriorPeerInteractions(
    runId: string,
    workers: AvatarRow[],
  ): Promise<InteractionRow[]> {
    const all: InteractionRow[] = [];
    const seen = new Set<string>();
    for (const w of workers) {
      const rows = await this.db.interactions.byAvatar(runId, w.id);
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        all.push(r);
      }
    }
    all.sort((a, b) =>
      a.roundIndex !== b.roundIndex
        ? a.roundIndex - b.roundIndex
        : a.orderInRound - b.orderInRound,
    );
    return all;
  }
}

function profileFromRow(row: AvatarRow): AvatarProfile {
  return {
    id: row.id,
    role_in_sim: row.roleInSim,
    name: row.name,
    role_label: row.roleLabel,
    personality: row.personality,
    values: row.values,
    baseline_output: row.baselineOutput,
  };
}

function isPairInteraction(
  it: InteractionRow,
  a: string,
  b: string,
): boolean {
  return (
    (it.initiatorAvatarId === a && it.responderAvatarId === b) ||
    (it.initiatorAvatarId === b && it.responderAvatarId === a)
  );
}

/**
 * Deterministic shuffle. Fisher-Yates seeded by a string. Used so manager
 * 1:1s happen in a reproducible — but seed-varying — worker order each round.
 */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = mulberry32(hashString(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
