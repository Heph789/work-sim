// The Runner. Owns the per-round loop, the run status state machine, and
// the discipline of "stream interactions live, settle the round in a
// transaction." Per docs/many-workers/simulation-engine.md.
//
// Per-round shape:
//   1. pickTag(seed, round_index)             ── one tag, shared across the round
//   2. INSERT round                           ── single row
//   3. Manager phase: for each worker (seeded order):
//        - llm.complete (free-text manager line)
//        - llm.completeStructured (worker AvatarTurn)
//        - INSERT interaction                 ── streamed, mid-round visible
//        - mutate workerState[worker]
//   4. Peer phase: pairs = samplePairs(seed, round_index, K=workers.length)
//        for each (a, b):
//          - orientPair → (initiator, responder)
//          - llm.completeStructured x2 (initiator first, then responder
//            seeing initiator's message)
//          - INSERT interaction
//          - mutate workerState[initiator] + workerState[responder]
//   5. Settle (TX): for each worker, INSERT round_avatar; INSERT manager
//        round_avatar (NULLs); UPDATE run.rounds_completed +
//        run.paper_total.
//
// Cooperative cancellation: the runner re-reads `run.status` between rounds.
// If anything other than 'running' is observed, it returns cleanly without
// transitioning to 'failed'.
//
// Error model: any throw from inside the loop is caught at the top level of
// `run()` and persisted as status='failed' with `failed_at_round = currentRound`.

import { v4 as uuid } from 'uuid';

import type { LLMClient } from '@work-sim/shared';
import {
  AvatarTurnSchema,
  type AvatarProfile,
  type AvatarTurn,
  type RunConfig,
} from '@work-sim/shared';
import {
  pickTag,
  samplePairs,
  orientPair,
} from '@work-sim/shared';

import type { AppDb } from '../db/index.js';
import type { AvatarRow } from '../db/schema.js';
import {
  paperSold,
  teamExpected,
  workerExpectedShare,
  signedDelta,
} from './scoring.js';
import {
  buildManagerPrompt,
  buildWorker1on1Prompt,
  buildPeerInitiatorPrompt,
  buildPeerResponderPrompt,
  INITIAL_SELF_PERCEPTION,
  PROMPT_TEMPLATE_VERSION,
} from './prompts.js';

void PROMPT_TEMPLATE_VERSION; // re-exported for routes/runs.ts via prompts.js

/**
 * Bumped whenever the runner / scoring logic changes meaningfully. Captured
 * in config_json so historical runs are tied to the engine version that
 * produced them — necessary for reproducibility.
 */
export const SIM_ENGINE_VERSION = 'v2';

/**
 * Running state per worker, mutated as the round progresses. Not persisted
 * directly — captured into round_avatar at settle, and into each interaction
 * row at the moment of the interaction.
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

  /**
   * Drive a single run from `pending` to a terminal state. Caller invokes
   * via `setImmediate(() => runner.run(id).catch(...))` from the POST /runs
   * handler so the HTTP response isn't blocked.
   */
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

    // Per-worker running state. Keyed by avatar.id. Initialized with the
    // shared initial-self-perception default and a neutral 50 morale; both
    // get replaced the moment the worker participates in their first
    // interaction.
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

    let currentRound = 0;
    try {
      for (let i = 1; i <= runRow.roundsTotal; i++) {
        currentRound = i;

        // Cooperative cancel checkpoint between rounds.
        const fresh = await this.db.runs.byId(runId);
        if (!fresh || fresh.status !== 'running') return;

        await this.runRound({
          runId,
          config,
          manager,
          workers,
          avatarsById,
          workerState,
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

  /**
   * Drive one round. Three phases: manager 1:1s, peer convos, settle. Each
   * interaction is inserted the moment it completes (so the live drilldown
   * sees them); settle wraps round_avatar inserts + run progress bump in a
   * single transaction.
   */
  private async runRound(args: {
    runId: string;
    config: RunConfig;
    manager: AvatarRow;
    workers: AvatarRow[];
    avatarsById: ReadonlyMap<string, AvatarRow>;
    workerState: Map<string, WorkerState>;
    roundIndex: number;
    targetPaper: number;
    paperTotalAtRoundStart: number;
    roundsCompletedAtRoundStart: number;
    roundsTotal: number;
  }): Promise<void> {
    // TODO: pickTag(config.situation_tag_seed, roundIndex), insert round row,
    // run manager phase + peer phase + settle. The pseudocode in
    // docs/many-workers/simulation-engine.md is the authoritative shape.
    void args;
    void this.runManagerPhase;
    void this.runPeerPhase;
    void this.settle;
    void pickTag;
  }

  /**
   * Manager phase — N 1:1s in seeded worker order. Each iteration:
   *   1. Build manager prompt (objective stats + manager↔W transcript).
   *   2. Build worker 1:1 prompt (self_perception + today + manager↔W transcript + manager line).
   *   3. Two LLM calls back-to-back: free-text manager, structured worker.
   *   4. Insert one interaction row (initiator=manager, responder=worker;
   *      manager-side morale fields NULL).
   *   5. Mutate workerState[worker] from worker's structured response.
   *
   * Returns the next free `order_in_round` (= N after the phase finishes).
   */
  private async runManagerPhase(args: {
    runId: string;
    roundId: string;
    roundIndex: number;
    situationTag: string;
    config: RunConfig;
    manager: AvatarRow;
    workers: AvatarRow[];
    avatarsById: ReadonlyMap<string, AvatarRow>;
    workerState: Map<string, WorkerState>;
    /** Per-run cumulative paper sold per worker, used in manager prompt context. */
    workerPaperTotalsBefore: ReadonlyMap<string, number>;
    targetPaper: number;
    paperTotalAtRoundStart: number;
    roundsCompletedAtRoundStart: number;
    roundsTotal: number;
    /** All interactions for this run from prior rounds; used for transcript rendering. */
    priorInteractions: ReadonlyArray<unknown>;
    orderStart: number;
  }): Promise<number> {
    // TODO: implement per the comment above. Use buildManagerPrompt /
    // buildWorker1on1Prompt + this.llm.complete / this.llm.completeStructured.
    void args;
    void buildManagerPrompt;
    void buildWorker1on1Prompt;
    void AvatarTurnSchema;
    return args.orderStart;
  }

  /**
   * Peer phase — K=N pairs in deterministic sample order. Each iteration:
   *   1. samplePairs(workers, K, "(seed, round_index, 'peer')") seeds the
   *      list once at phase entry; orientPair seeds each coin from
   *      "(seed, round_index, 'peer', orderInRound)".
   *   2. Two structured LLM calls — initiator first, then responder seeing
   *      initiator's message.
   *   3. Insert one interaction row with both sides populated.
   *   4. Mutate workerState[initiator] + workerState[responder].
   *
   * N=1 → samplePairs returns []; the phase is a no-op.
   */
  private async runPeerPhase(args: {
    runId: string;
    roundId: string;
    roundIndex: number;
    situationTag: string;
    config: RunConfig;
    workers: AvatarRow[];
    avatarsById: ReadonlyMap<string, AvatarRow>;
    workerState: Map<string, WorkerState>;
    priorInteractions: ReadonlyArray<unknown>;
    orderStart: number;
  }): Promise<number> {
    // TODO: implement per the comment above. Use samplePairs / orientPair
    // and buildPeerInitiatorPrompt / buildPeerResponderPrompt.
    void args;
    void samplePairs;
    void orientPair;
    void buildPeerInitiatorPrompt;
    void buildPeerResponderPrompt;
    return args.orderStart;
  }

  /**
   * Settle — atomic tail of the round. Wraps the following in a TX:
   *   - One round_avatar row per worker, with morale + paper_sold computed
   *     from the worker's end-of-round morale.
   *   - One round_avatar row for the manager (morale / paper_sold NULL).
   *   - run.bumpProgress(roundIndex, sum(paper_sold)).
   *
   * After settle, the dashboard read picks up the new rounds_completed +
   * paper_total on the next poll.
   */
  private async settle(args: {
    runId: string;
    roundId: string;
    roundIndex: number;
    manager: AvatarRow;
    workers: AvatarRow[];
    workerState: Map<string, WorkerState>;
  }): Promise<void> {
    // TODO: pseudocode:
    //   const workerRows = workers.map(w => {
    //     const s = workerState.get(w.id)!;
    //     return {
    //       id: uuid(), runId, roundId, roundIndex,
    //       avatarId: w.id, morale: s.morale,
    //       moraleRationale: s.moraleRationale,
    //       selfPerception: s.selfPerception,
    //       paperSold: paperSold(w.baselineOutput, s.morale),
    //       createdAt: Date.now(),
    //     };
    //   });
    //   const managerRow = { ..., avatarId: manager.id, morale: null,
    //                        moraleRationale: null, selfPerception: null,
    //                        paperSold: null };
    //   const total = workerRows.reduce((s, r) => s + (r.paperSold ?? 0), 0);
    //   await this.db.transaction(async tx => {
    //     await tx.roundAvatars.insertMany([...workerRows, managerRow]);
    //     await tx.runs.bumpProgress(runId, roundIndex, total);
    //   });
    void args;
    void uuid;
    void paperSold;
  }

  /**
   * Helper: assemble the per-prompt objective context for a given worker.
   * Pulled out so the manager prompt builder gets exactly what it needs and
   * nothing more — keeps the information-asymmetry guarantee local.
   */
  private workerContextForManager(args: {
    worker: AvatarRow;
    workerPaperTotal: number;
    targetPaper: number;
    numWorkers: number;
    roundsCompleted: number;
    roundsTotal: number;
  }): {
    workerPaperTotal: number;
    workerExpectedShare: number;
    workerDelta: ReturnType<typeof signedDelta>;
  } {
    const expected = workerExpectedShare({
      targetPaper: args.targetPaper,
      numWorkers: args.numWorkers,
      roundsCompleted: args.roundsCompleted,
      roundsTotal: args.roundsTotal,
    });
    return {
      workerPaperTotal: args.workerPaperTotal,
      workerExpectedShare: expected,
      workerDelta: signedDelta(args.workerPaperTotal, expected),
    };
  }

  /**
   * Helper: typed AvatarTurn coercion. Centralized so the call sites don't
   * each repeat the cast — the LLMClient validates against the schema, but
   * TypeScript needs the explicit type for downstream code.
   */
  private asAvatarTurn(t: AvatarTurn): AvatarTurn {
    return t;
  }

  /**
   * Helper: read team-level expected output for use by both the manager
   * prompt and (later) the dashboard response shaper.
   */
  private teamExpectedFor(
    targetPaper: number,
    roundsCompleted: number,
    roundsTotal: number,
  ): number {
    return teamExpected({ targetPaper, roundsCompleted, roundsTotal });
  }

  /**
   * Helper: convert a config-json AvatarProfile snapshot into the row-shape
   * the prompt builders need. The DB rows already have the right fields, but
   * the prompt builders accept AvatarProfile (the wire shape) so they can be
   * unit-tested without a DB. This adapter bridges the two.
   */
  private profile(row: AvatarRow): AvatarProfile {
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
}
