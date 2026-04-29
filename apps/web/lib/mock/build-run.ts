// Builder used by every scenario file: take an avatar roster + scenario knobs,
// produce a fully-populated MockRun. Centralizes the "loop 1..N rounds calling
// fabricateRound" boilerplate so the scenarios themselves stay declarative.
//
// MockRun stores the dashboard-shaped RunDetail (rounds + per_avatar) plus
// internal drilldown bookkeeping (interactions + per-avatar round entries),
// since the dashboard endpoint and the per-avatar drilldown endpoint serve
// different shapes from the same simulated state.

import type {
  AvatarProfile,
  AvatarRole,
  DashboardPerAvatar,
  RunDetail,
  RunStatus,
  SignedDelta,
} from '@work-sim/shared';
import { fabricateRound, STARTING_MORALE } from './fabricate.js';
import type { MockDrilldown, MockRun } from './types.js';

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
  /** Manager profile (exactly one). Profile fields excluding role_in_sim and id. */
  manager: Omit<AvatarProfile, 'role_in_sim' | 'id'>;
  /** Worker profiles (≥1). */
  workers: Array<Omit<AvatarProfile, 'role_in_sim' | 'id'>>;
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
 * Build a complete MockRun from a scenario spec. Iterates 1..rounds_completed
 * calling fabricateRound, threading per-worker morale forward and accumulating
 * dashboard + drilldown projections.
 */
export function buildRun(args: BuildRunArgs): MockRun {
  const id = mockRunId(args.scenario);
  const seed = args.situation_tag_seed ?? hash(id);

  const managerProfile: AvatarProfile = {
    id: `${id}-mgr`,
    role_in_sim: 'manager',
    ...args.manager,
  };
  const workerProfiles: AvatarProfile[] = args.workers.map((w, i) => ({
    id: `${id}-w${i + 1}`,
    role_in_sim: 'worker',
    ...w,
  }));
  const avatars: AvatarProfile[] = [managerProfile, ...workerProfiles];

  const created_at = args.created_at ?? Date.now() - 60_000;
  const tick_started_at = args.tick_started_at ?? Date.now();

  const projection = projectRounds({
    avatars,
    seed,
    fromRound: 1,
    toRound: args.rounds_completed,
    createdAtBase: created_at,
    initialMorale: Object.fromEntries(workerProfiles.map((w) => [w.id, STARTING_MORALE])),
  });

  const perAvatar = buildPerAvatar({
    avatars,
    projection,
    targetPaper: args.target_paper,
    roundsCompleted: args.rounds_completed,
    roundsTotal: args.rounds_total,
  });
  const teamExpected = computeTeamExpected({
    targetPaper: args.target_paper,
    roundsCompleted: args.rounds_completed,
    roundsTotal: args.rounds_total,
  });
  const teamDelta = computeSignedDelta(projection.paperTotal, teamExpected);

  const detail: RunDetail = {
    id,
    created_at,
    status: args.status,
    rounds_total: args.rounds_total,
    rounds_completed: args.rounds_completed,
    target_paper: args.target_paper,
    paper_total: projection.paperTotal,
    team_expected: teamExpected,
    team_delta: teamDelta,
    experiment_id: null,
    config: {
      avatars: avatars.slice(),
      model: 'gpt-4.1',
      temperature: 0.8,
      top_p: 1.0,
      prompt_template_version: 'mock-1',
      sim_engine_version: 'mock-1',
    },
    rounds: projection.rounds,
    per_avatar: perAvatar,
    error_message: args.error_message ?? null,
    failed_at_round: args.failed_at_round ?? null,
  };

  const drilldown: MockDrilldown = {
    interactions: projection.interactions,
    roundEntries: projection.roundEntries,
    avatarProfiles: Object.fromEntries(avatars.map((a) => [a.id, a])),
  };

  return { ...detail, tick_started_at, _drilldown: drilldown };
}

/** Internal projection: drives fabrication and accumulates both wire shapes. */
interface RoundsProjection {
  rounds: RunDetail['rounds'];
  interactions: MockDrilldown['interactions'];
  roundEntries: MockDrilldown['roundEntries'];
  endMorale: Record<string, number>;
  paperTotal: number;
}

interface ProjectRoundsArgs {
  avatars: AvatarProfile[];
  seed: number;
  fromRound: number;
  toRound: number;
  createdAtBase: number;
  initialMorale: Record<string, number>;
}

/**
 * Fabricate rounds [fromRound..toRound] inclusive. Returns both projections
 * (dashboard rounds, drilldown interactions, per-avatar round entries) plus
 * end-state metadata for the caller (or for the next tick).
 */
export function projectRounds(args: ProjectRoundsArgs): RoundsProjection {
  const workers = args.avatars.filter((a) => a.role_in_sim === 'worker');
  const includePeer = workers.length >= 2;

  const rounds: RoundsProjection['rounds'] = [];
  const interactions: RoundsProjection['interactions'] = [];
  const roundEntries: RoundsProjection['roundEntries'] = {};
  for (const a of args.avatars) roundEntries[a.id] = [];
  let prevMorale = { ...args.initialMorale };
  let paperTotal = 0;

  for (let r = args.fromRound; r <= args.toRound; r++) {
    const roundCreatedAt = args.createdAtBase + r * 1000;
    const fr = fabricateRound({
      roundIndex: r,
      prevMorale,
      avatars: args.avatars,
      seed: args.seed,
      createdAtBase: roundCreatedAt,
      includePeer,
    });
    rounds.push(fr.dashboardRound);
    interactions.push(...fr.interactions);
    for (const [aid, entry] of Object.entries(fr.roundEntries)) {
      roundEntries[aid]!.push(entry);
    }
    prevMorale = fr.endMorale;
    paperTotal += fr.paperThisRound;
  }

  return { rounds, interactions, roundEntries, endMorale: prevMorale, paperTotal };
}

interface BuildPerAvatarArgs {
  avatars: AvatarProfile[];
  projection: RoundsProjection;
  targetPaper: number;
  roundsCompleted: number;
  roundsTotal: number;
}

/**
 * Aggregate per-avatar dashboard rows from the projected rounds. For workers,
 * computes worker_expected_share + worker_delta against the per-worker target
 * proportional to rounds completed.
 */
export function buildPerAvatar(args: BuildPerAvatarArgs): DashboardPerAvatar[] {
  const { avatars, projection, targetPaper, roundsCompleted, roundsTotal } = args;
  const numWorkers = avatars.filter((a) => a.role_in_sim === 'worker').length;
  const expectedShare =
    numWorkers > 0 && roundsTotal > 0
      ? (targetPaper / numWorkers) * (roundsCompleted / roundsTotal)
      : 0;

  return avatars.map((a) => {
    const role: AvatarRole = a.role_in_sim;
    const entries = projection.roundEntries[a.id] ?? [];
    const morale_curve = entries.map((e) => e.morale);
    const paper_per_round = entries.map((e) => e.paper_sold);
    const last_morale =
      [...morale_curve].reverse().find((m): m is number => m !== null) ?? null;
    const isWorker = role === 'worker';
    const paper_total = isWorker
      ? entries.reduce((sum, e) => sum + (e.paper_sold ?? 0), 0)
      : null;
    const worker_expected_share = isWorker ? Math.round(expectedShare) : null;
    const worker_delta =
      isWorker && paper_total !== null && worker_expected_share !== null
        ? computeSignedDelta(paper_total, worker_expected_share)
        : null;

    return {
      avatar_id: a.id,
      name: a.name,
      role_in_sim: role,
      role_label: a.role_label,
      paper_total,
      worker_expected_share,
      worker_delta,
      last_morale,
      morale_curve,
      paper_per_round,
    };
  });
}

interface ComputeTeamExpectedArgs {
  targetPaper: number;
  roundsCompleted: number;
  roundsTotal: number;
}

/** target_paper × rounds_completed / rounds_total, rounded. */
export function computeTeamExpected(args: ComputeTeamExpectedArgs): number {
  if (args.roundsTotal === 0) return 0;
  return Math.round((args.targetPaper * args.roundsCompleted) / args.roundsTotal);
}

/** Signed delta of `actual` vs `expected`. */
export function computeSignedDelta(actual: number, expected: number): SignedDelta {
  const diff = actual - expected;
  return { abs: Math.abs(diff), direction: diff >= 0 ? 'above' : 'below' };
}

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
