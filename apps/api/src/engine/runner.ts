// The Runner. Owns the per-round loop, the runs status state machine, and
// the discipline of "persist each round to the DB the moment it completes."
// That last property is the most important architectural commitment in the
// whole prototype (locked-decisions.md #5) — it's what enables future SSE,
// pause/resume, and crash recovery as additive changes rather than rewrites.
//
// One Runner instance is constructed at boot in index.ts and is shared
// across all runs. Each `run(id)` invocation is a fully self-contained
// async task driven from POST /runs via setImmediate(...).

import { v4 as uuid } from 'uuid';

import type { LLMClient } from '@work-sim/shared';
import {
  WorkerResponseSchema,
  type AgentProfile,
  type RoundView,
  type RunConfig,
  type WorkerResponse,
} from '@work-sim/shared';
import { pickTag } from '@work-sim/shared';

import type { AppDb } from '../db/index.js';
import { paperSold } from './scoring.js';
import { buildManagerPrompt, buildWorkerPrompt } from './prompts.js';

/**
 * Bumped whenever the runner / scoring logic changes meaningfully. Captured
 * in config_json so historical runs are tied to the engine version that
 * produced them — necessary for reproducibility.
 */
export const SIM_ENGINE_VERSION = 'v1';

export class Runner {
  constructor(
    private llm: LLMClient,
    private db: AppDb,
  ) {}

  /**
   * Drive a single run from `pending` to a terminal state. Caller invokes
   * via `setImmediate(() => runner.run(id).catch(console.error))` from the
   * POST /runs handler so the HTTP response isn't blocked.
   *
   * Errors thrown from any LLM call (after retries) are caught here and
   * persisted as `runs.status='failed'` with `error_message` and
   * `failed_at_round`. The runner does NOT rethrow — the caller's `.catch`
   * is just a safety net for unexpected programmer errors.
   */
  async run(runId: string): Promise<void> {
    const run = await this.db.runs.byId(runId);
    if (!run) throw new Error(`run ${runId} not found`);

    const config = JSON.parse(run.configJson) as RunConfig;
    const { manager, worker } = this.extractAgents(config);

    await this.db.runs.setStatus(runId, 'running');

    let lastSelfPerception: string | null = null;
    let lastMorale: number | null = null;
    const priorRounds: Pick<RoundView, 'manager_message' | 'worker_message'>[] = [];
    let currentRound = 0;

    try {
      for (let i = 1; i <= run.roundsTotal; i++) {
        currentRound = i;
        const fresh = await this.db.runs.byId(runId);
        if (!fresh || fresh.status !== 'running') return;

        const tag = pickTag(config.situation_tag_seed, i);

        const managerMsg = await this.llm.complete(
          buildManagerPrompt({
            manager,
            worker,
            priorRounds,
            situationTag: tag,
            target: fresh.targetPaper,
            paperTotal: fresh.paperTotal,
            roundsCompleted: fresh.roundsCompleted,
            roundsTotal: fresh.roundsTotal,
          }),
          { model: config.model, temperature: config.temperature, topP: config.top_p },
        );

        const workerRes: WorkerResponse = await this.llm.completeStructured(
          buildWorkerPrompt({
            manager,
            worker,
            priorRounds,
            situationTag: tag,
            managerMessage: managerMsg,
            selfPerception: lastSelfPerception,
            priorMorale: lastMorale,
          }),
          WorkerResponseSchema,
          'WorkerResponse',
          { model: config.model, temperature: config.temperature, topP: config.top_p },
        );

        const paperSoldThisRound = paperSold(worker.baseline_output, workerRes.morale);

        // Two back-to-back sync writes via better-sqlite3. We don't wrap in a
        // transaction because better-sqlite3 transactions can't host async
        // callbacks; for a single-process prototype the only data risk is a
        // process kill between these two calls, which would leave a round row
        // without its progress bump — acceptable, and easy to reconcile by
        // querying max(round_index) on boot if we ever care.
        await this.db.rounds.insert({
          id: uuid(),
          runId,
          roundIndex: i,
          situationTag: tag,
          managerMessage: managerMsg,
          workerMessage: workerRes.message,
          workerSelfPerception: workerRes.updated_self_perception,
          workerMoraleRationale: workerRes.morale_rationale,
          morale: workerRes.morale,
          paperSold: paperSoldThisRound,
          createdAt: Date.now(),
        });
        await this.db.runs.bumpProgress(runId, i, paperSoldThisRound);

        lastSelfPerception = workerRes.updated_self_perception;
        lastMorale = workerRes.morale;
        priorRounds.push(
          this.toPriorRound({ managerMessage: managerMsg, workerMessage: workerRes.message }),
        );
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
   * Helper: hydrate the agent snapshots from a parsed RunConfig. Throws if
   * the run doesn't have exactly one manager and one worker (defensive —
   * the route validator enforces this, but the runner shouldn't crash
   * mid-loop if the invariant is violated).
   */
  private extractAgents(config: RunConfig): { manager: AgentProfile; worker: AgentProfile } {
    const manager = config.agents.find((a) => a.role_in_sim === 'manager');
    const worker = config.agents.find((a) => a.role_in_sim === 'worker');
    if (!manager || !worker) {
      throw new Error('config requires exactly one manager and one worker');
    }
    return { manager, worker };
  }

  /**
   * Helper: project a freshly-inserted round into the priorRounds array we
   * pass to the next round's prompt builders. We only need the message text
   * here — situation_tag and morale are state, not memory.
   */
  private toPriorRound(args: {
    managerMessage: string;
    workerMessage: string;
  }): Pick<RoundView, 'manager_message' | 'worker_message'> {
    return {
      manager_message: args.managerMessage,
      worker_message: args.workerMessage,
    };
  }
}
