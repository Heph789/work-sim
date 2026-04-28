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
    // High-level shape (per simulation-engine.md):
    //
    //   1. Load the run row + parse config_json.
    //   2. Identify manager/worker snapshots from config.agents.
    //   3. UPDATE runs SET status='running'.
    //   4. For round_index in 1..rounds_total:
    //        a. Re-read runs.status; exit cleanly if not 'running' (cooperative cancel).
    //        b. tag = pickTag(seed, round_index).
    //        c. managerMsg = await llm.complete(buildManagerPrompt(...)).
    //        d. workerRes  = await llm.completeStructured(buildWorkerPrompt(...),
    //                                                     WorkerResponseSchema, ...).
    //        e. paperSoldThisRound = paperSold(worker.baseline_output, workerRes.morale).
    //        f. db.transaction:
    //             rounds.insert({...})
    //             runs.bumpProgress(runId, round_index, paperSoldThisRound).
    //        g. Update local state: lastSelfPerception = workerRes.updated_self_perception;
    //                               priorRounds.push({...}).
    //   5. UPDATE runs SET status='completed'.
    //
    //   On any throw inside the loop:
    //     UPDATE runs SET status='failed', error_message=<msg>,
    //                     failed_at_round=<current round_index>.

    // TODO: implement.
    void runId;
    void uuid;
    void this.llm;
    void this.db;
    void WorkerResponseSchema;
    void pickTag;
    void buildManagerPrompt;
    void buildWorkerPrompt;
    void paperSold;
    void SIM_ENGINE_VERSION;
    throw new Error('Runner.run: not implemented');
  }

  /**
   * Helper: hydrate the agent snapshots from a parsed RunConfig. Throws if
   * the run doesn't have exactly one manager and one worker (defensive —
   * the route validator enforces this, but the runner shouldn't crash
   * mid-loop if the invariant is violated).
   */
  private extractAgents(config: RunConfig): { manager: AgentProfile; worker: AgentProfile } {
    // TODO:
    //   const manager = config.agents.find(a => a.role_in_sim === 'manager');
    //   const worker  = config.agents.find(a => a.role_in_sim === 'worker');
    //   if (!manager || !worker) throw new Error('config requires one manager and one worker');
    //   return { manager, worker };
    void config;
    throw new Error('Runner.extractAgents: not implemented');
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
