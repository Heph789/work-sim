// Builder used by every scenario file: take an avatar roster + scenario knobs,
// produce a fully-populated MockRun. Centralizes the "loop 1..N rounds calling
// fabricateRound" boilerplate so the scenarios themselves stay declarative.

import type {
  AvatarProfile,
  AvatarView,
  RunDetail,
  RunStatus,
} from '@work-sim/shared';
import { fabricateRound, STARTING_MORALE } from './fabricate.js';
import type { MockRun } from './types.js';

let counter = 0;
/**
 * Stable per-run id for seed data. Counter-based (not random) so a scenario
 * builder rebuilt twice in the same dev session reuses ids if anything were
 * to depend on that. Format: `mock-<scenario>-<n>`.
 */
export function mockRunId(scenario: string): string {
  counter += 1;
  return `mock-${scenario}-${counter.toString(36)}`;
}

/** Per-avatar input matches AvatarProfile but without the role_in_sim split. */
export interface BuildRunArgs {
  scenario: string;
  /** Manager profile (exactly one). */
  manager: Omit<AvatarProfile, 'role_in_sim'>;
  /** Worker profiles (≥1). */
  workers: Array<Omit<AvatarProfile, 'role_in_sim'>>;
  status: RunStatus;
  rounds_total: number;
  /** How many rounds are already complete in the seed data. */
  rounds_completed: number;
  target_paper: number;
  /** Optional override; default Date.now() - some recent offset. */
  created_at?: number;
  /** Set on 'failed' runs. */
  failed_at_round?: number;
  error_message?: string;
  /** Seed for situation_tag picking. Default: hash of run id at creation. */
  situation_tag_seed?: number;
  /** Epoch ms; for running runs, used as the tick anchor. Default: now. */
  tick_started_at?: number;
}

/**
 * Build a complete MockRun. Iterates 1..rounds_completed calling
 * fabricateRound, threading per-worker morale forward.
 */
export function buildRun(args: BuildRunArgs): MockRun {
  const id = mockRunId(args.scenario);
  const seed = args.situation_tag_seed ?? hash(id);

  const managerAvatar: AvatarView = {
    id: `${id}-mgr`,
    role_in_sim: 'manager',
    ...args.manager,
  };
  const workerAvatars: AvatarView[] = args.workers.map((w, i) => ({
    id: `${id}-w${i + 1}`,
    role_in_sim: 'worker',
    ...w,
  }));
  const avatars: AvatarView[] = [managerAvatar, ...workerAvatars];

  const created_at = args.created_at ?? Date.now() - 60_000;
  const tick_started_at = args.tick_started_at ?? Date.now();

  // Fabricate completed rounds.
  let prevMorale: Record<string, number> = Object.fromEntries(
    workerAvatars.map((w) => [w.id, STARTING_MORALE]),
  );
  let paperTotal = 0;
  const rounds = [];
  const round_avatars = [];
  const interactions = [];

  for (let r = 1; r <= args.rounds_completed; r++) {
    // Spread per-round timestamps across the recent past so the UI shows
    // sensible timeline ordering.
    const roundCreatedAt = created_at + r * 1000;
    const fr = fabricateRound({
      roundIndex: r,
      prevMorale,
      avatars,
      seed,
      createdAtBase: roundCreatedAt,
      includePeer: workerAvatars.length >= 2,
    });
    rounds.push(fr.round);
    round_avatars.push(...fr.roundAvatars);
    interactions.push(...fr.interactions);
    prevMorale = fr.endMorale;
    paperTotal += fr.paperThisRound;
  }

  const detail: RunDetail = {
    id,
    created_at,
    status: args.status,
    rounds_total: args.rounds_total,
    rounds_completed: args.rounds_completed,
    target_paper: args.target_paper,
    paper_total: paperTotal,
    experiment_id: null,
    config: {
      avatars: avatars.map((a) => ({
        role_in_sim: a.role_in_sim,
        name: a.name,
        role_label: a.role_label,
        personality: a.personality,
        values: a.values,
        baseline_output: a.baseline_output,
      })),
      model: 'gpt-4.1',
      temperature: 0.8,
      top_p: 1.0,
      prompt_template_version: 'mock-1',
      sim_engine_version: 'mock-1',
    },
    avatars,
    rounds,
    round_avatars,
    interactions,
    error_message: args.error_message ?? null,
    failed_at_round: args.failed_at_round ?? null,
  };

  return { ...detail, tick_started_at };
}

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
