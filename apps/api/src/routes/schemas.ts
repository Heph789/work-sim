// HTTP request validation schemas + response shapers for the many-workers
// iteration. Anything coming from the network is validated here before
// hitting the engine.
//
// Bounds are intentionally loose during the prototype phase; tighten when we
// start running real experiments. See docs/many-workers/api.md for the
// canonical wire shapes.

import { z } from 'zod';

import type {
  AvatarDetail,
  AvatarProfile,
  AvatarRole,
  DashboardPerAvatar,
  DashboardRound,
  DashboardRoundAvatar,
  DrilldownInteraction,
  DrilldownRoundEntry,
  RunConfig,
  RunDetail,
  RunListItem,
  RunStatus,
  SignedDelta,
} from '@work-sim/shared';

// ─── Per-avatar shape (POST /runs body) ─────────────────────────────────────

/**
 * Per-avatar request shape — must match AvatarProfile minus `id`. The API
 * generates `id` server-side. Bounds match docs/many-workers/api.md.
 */
export const AvatarProfileRequestSchema = z.object({
  role_in_sim: z.enum(['manager', 'worker']),
  name: z.string().min(1).max(80),
  role_label: z.string().min(1).max(80),
  personality: z.string().min(1).max(2000),
  values: z.string().min(1).max(2000),
  // Managers: 0 or 1 (ignored). Workers: ≥1 (refined below).
  baseline_output: z.number().int().min(0).max(100),
});

/**
 * Body of POST /runs. Refined for the v1 invariants:
 *   - exactly one manager
 *   - ≥1 workers
 *   - unique names within the avatars array (avoids ambiguous transcript lines)
 *   - worker baseline_output ≥ 1
 */
export const CreateRunRequestSchema = z
  .object({
    avatars: z.array(AvatarProfileRequestSchema).min(2),
    target_paper: z.number().int().min(1),
    rounds_total: z.number().int().min(1).max(50),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .refine(
    (b) => b.avatars.filter((a) => a.role_in_sim === 'manager').length === 1,
    { message: 'avatars must contain exactly one manager' },
  )
  .refine(
    (b) => b.avatars.filter((a) => a.role_in_sim === 'worker').length >= 1,
    { message: 'avatars must contain at least one worker' },
  )
  .refine(
    (b) => {
      const names = b.avatars.map((a) => a.name);
      return new Set(names).size === names.length;
    },
    { message: 'avatar names must be unique within a run' },
  )
  .refine(
    (b) =>
      b.avatars
        .filter((a) => a.role_in_sim === 'worker')
        .every((w) => w.baseline_output >= 1),
    { message: 'worker baseline_output must be >= 1' },
  );

/** Query string for GET /runs pagination. */
export const ListRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** created_at unix-ms cursor (rows strictly older than this are returned). */
  cursor: z.coerce.number().int().nullable().optional(),
});

/** Query string for GET /runs/:id/avatars/:avatarId. */
export const AvatarDrilldownQuerySchema = z.object({
  /** When present, restrict the interaction feed to the avatar↔partner pair. */
  partner: z.string().min(1).optional(),
});

// ─── Row-like shapes (decouple shapers from drizzle generic types) ──────────

export interface RunRowLike {
  id: string;
  createdAt: number;
  status: RunStatus;
  roundsTotal: number;
  roundsCompleted: number;
  targetPaper: number;
  paperTotal: number;
  experimentId: string | null;
  configJson: string;
  errorMessage: string | null;
  failedAtRound: number | null;
}

export interface AvatarRowLike {
  id: string;
  runId: string;
  roleInSim: AvatarRole;
  name: string;
  roleLabel: string;
  personality: string;
  values: string;
  baselineOutput: number;
}

export interface RoundRowLike {
  id: string;
  roundIndex: number;
  situationTag: string;
  createdAt: number;
}

export interface RoundAvatarRowLike {
  roundIndex: number;
  avatarId: string;
  morale: number | null;
  moraleRationale: string | null;
  selfPerception: string | null;
  paperSold: number | null;
}

export interface InteractionRowLike {
  id: string;
  roundIndex: number;
  orderInRound: number;
  situationTag: string;
  initiatorAvatarId: string;
  responderAvatarId: string;
  initiatorMessage: string;
  responderMessage: string;
  initiatorMoraleDelta: number | null;
  initiatorMoraleRationale: string | null;
  responderMoraleDelta: number;
  responderMoraleRationale: string;
  createdAt: number;
}

// ─── Response shapers — list + dashboard ────────────────────────────────────

/**
 * Project a run row → list-item shape. Pulls names out of the config_json
 * snapshot rather than joining `avatar` per row (the snapshot has them).
 */
export function toRunListItem(row: RunRowLike): RunListItem {
  const config = JSON.parse(row.configJson) as RunConfig;
  const manager = config.avatars.find(
    (a: AvatarProfile) => a.role_in_sim === 'manager',
  );
  const workers = config.avatars.filter(
    (a: AvatarProfile) => a.role_in_sim === 'worker',
  );
  return {
    id: row.id,
    created_at: row.createdAt,
    status: row.status,
    rounds_total: row.roundsTotal,
    rounds_completed: row.roundsCompleted,
    target_paper: row.targetPaper,
    paper_total: row.paperTotal,
    hit_target:
      row.status === 'completed' ? row.paperTotal >= row.targetPaper : null,
    manager_name: manager?.name ?? '',
    worker_names: workers.map((w) => w.name),
  };
}

/**
 * Project a run row + its avatars + per-round-per-avatar state → dashboard
 * shape. Aggregates per-avatar morale curves and paper totals here so the
 * frontend doesn't have to.
 *
 * Strips `situation_tag_seed` from the public config block (internal detail).
 * Does NOT include any interaction text or self_perception — those are
 * private/large; drilldown handles them.
 */
export function toRunDetail(args: {
  run: RunRowLike;
  avatars: AvatarRowLike[];
  rounds: RoundRowLike[];
  /** All round_avatar rows for this run, in any order — function sorts. */
  roundAvatars: RoundAvatarRowLike[];
  /** scoring helpers passed in so this shaper has no engine import. */
  helpers: {
    teamExpected(args: {
      targetPaper: number;
      roundsCompleted: number;
      roundsTotal: number;
    }): number;
    workerExpectedShare(args: {
      targetPaper: number;
      numWorkers: number;
      roundsCompleted: number;
      roundsTotal: number;
    }): number;
    signedDelta(actual: number, expected: number): SignedDelta;
  };
}): RunDetail {
  const { run, avatars, rounds, roundAvatars, helpers } = args;
  const config = JSON.parse(run.configJson) as RunConfig;
  // Strip situation_tag_seed from the public config.
  const {
    situation_tag_seed: _seed,
    ...publicConfig
  } = config;
  void _seed;

  const teamExp = helpers.teamExpected({
    targetPaper: run.targetPaper,
    roundsCompleted: run.roundsCompleted,
    roundsTotal: run.roundsTotal,
  });
  const teamDelta = helpers.signedDelta(run.paperTotal, teamExp);

  const roundsSorted = [...rounds].sort((a, b) => a.roundIndex - b.roundIndex);
  const roundAvatarsByRound = new Map<number, RoundAvatarRowLike[]>();
  for (const ra of roundAvatars) {
    const arr = roundAvatarsByRound.get(ra.roundIndex) ?? [];
    arr.push(ra);
    roundAvatarsByRound.set(ra.roundIndex, arr);
  }

  const dashboardRounds: DashboardRound[] = roundsSorted.map((r) => {
    const avatarRows = roundAvatarsByRound.get(r.roundIndex) ?? [];
    const dashboardAvatars: DashboardRoundAvatar[] = avatarRows.map((ra) => ({
      avatar_id: ra.avatarId,
      morale: ra.morale,
      paper_sold: ra.paperSold,
    }));
    return {
      round_index: r.roundIndex,
      situation_tag: r.situationTag,
      created_at: r.createdAt,
      avatars: dashboardAvatars,
    };
  });

  const numWorkers = avatars.filter((a) => a.roleInSim === 'worker').length;

  const perAvatar: DashboardPerAvatar[] = avatars.map((a) => {
    const isWorker = a.roleInSim === 'worker';
    const ownEntries = roundAvatars
      .filter((ra) => ra.avatarId === a.id)
      .sort((x, y) => x.roundIndex - y.roundIndex);

    // Build per-round-index series (length = rounds_completed).
    const moraleCurve: Array<number | null> = [];
    const paperPerRound: Array<number | null> = [];
    for (let i = 1; i <= run.roundsCompleted; i++) {
      const entry = ownEntries.find((e) => e.roundIndex === i);
      moraleCurve.push(entry ? entry.morale : null);
      paperPerRound.push(entry ? entry.paperSold : null);
    }

    let lastMorale: number | null = null;
    for (let i = moraleCurve.length - 1; i >= 0; i--) {
      if (moraleCurve[i] != null) {
        lastMorale = moraleCurve[i] as number;
        break;
      }
    }

    let paperTotal: number | null = null;
    let expectedShare: number | null = null;
    let workerDelta: SignedDelta | null = null;
    if (isWorker) {
      paperTotal = paperPerRound.reduce(
        (acc: number, v) => acc + (v ?? 0),
        0,
      );
      expectedShare = helpers.workerExpectedShare({
        targetPaper: run.targetPaper,
        numWorkers,
        roundsCompleted: run.roundsCompleted,
        roundsTotal: run.roundsTotal,
      });
      workerDelta = helpers.signedDelta(paperTotal, expectedShare);
    }

    return {
      avatar_id: a.id,
      name: a.name,
      role_in_sim: a.roleInSim,
      role_label: a.roleLabel,
      paper_total: paperTotal,
      worker_expected_share: expectedShare,
      worker_delta: workerDelta,
      last_morale: lastMorale,
      morale_curve: moraleCurve,
      paper_per_round: paperPerRound,
    };
  });

  return {
    id: run.id,
    created_at: run.createdAt,
    status: run.status,
    rounds_total: run.roundsTotal,
    rounds_completed: run.roundsCompleted,
    target_paper: run.targetPaper,
    paper_total: run.paperTotal,
    team_expected: teamExp,
    team_delta: teamDelta,
    experiment_id: run.experimentId,
    config: publicConfig,
    rounds: dashboardRounds,
    per_avatar: perAvatar,
    error_message: run.errorMessage,
    failed_at_round: run.failedAtRound,
  };
}

// ─── Response shaper — drilldown ────────────────────────────────────────────

/**
 * Project the drilldown response. Critical privacy property: the subject
 * avatar's own self_perception comes through on `rounds[]` (from the
 * round_avatar table), but `interactions[]` strips out both sides'
 * self_perception entirely so we never accidentally expose another avatar's
 * inner monologue via the initiator/responder field of an interaction the
 * subject participated in.
 */
export function toAvatarDetail(args: {
  subject: AvatarRowLike;
  partner: AvatarRowLike | null;
  /** Subject's per-round entries from round_avatar, ordered by round_index. */
  subjectRoundAvatars: RoundAvatarRowLike[];
  /** Already filtered + ordered by the route handler. */
  interactions: InteractionRowLike[];
  /** Resolved per-id avatar metadata — drives the embedded initiator/responder names. */
  avatarsById: ReadonlyMap<string, AvatarRowLike>;
  /** Per-run rounds metadata — used to attach situation_tag to subject rounds. */
  rounds: ReadonlyArray<RoundRowLike>;
}): AvatarDetail {
  const { subject, partner, subjectRoundAvatars, interactions, avatarsById } =
    args;

  const situationTagByRound = new Map<number, string>(
    args.rounds.map((r) => [r.roundIndex, r.situationTag]),
  );

  const rounds: DrilldownRoundEntry[] = subjectRoundAvatars.map((r) => ({
    round_index: r.roundIndex,
    situation_tag: situationTagByRound.get(r.roundIndex) ?? '',
    morale: r.morale,
    morale_rationale: r.moraleRationale,
    self_perception: r.selfPerception,
    paper_sold: r.paperSold,
  }));

  const drilldownInteractions: DrilldownInteraction[] = interactions.map(
    (it) => {
      const init = avatarsById.get(it.initiatorAvatarId);
      const resp = avatarsById.get(it.responderAvatarId);
      return {
        id: it.id,
        round_index: it.roundIndex,
        order_in_round: it.orderInRound,
        situation_tag: it.situationTag,
        initiator: {
          id: it.initiatorAvatarId,
          name: init?.name ?? '',
          role_in_sim: init?.roleInSim ?? 'worker',
        },
        responder: {
          id: it.responderAvatarId,
          name: resp?.name ?? '',
          role_in_sim: resp?.roleInSim ?? 'worker',
        },
        initiator_message: it.initiatorMessage,
        responder_message: it.responderMessage,
        initiator_morale_delta: it.initiatorMoraleDelta,
        initiator_morale_rationale: it.initiatorMoraleRationale,
        responder_morale_delta: it.responderMoraleDelta,
        responder_morale_rationale: it.responderMoraleRationale,
        // self_perception fields deliberately absent — see fn-level comment.
        created_at: it.createdAt,
      };
    },
  );

  return {
    avatar: {
      id: subject.id,
      role_in_sim: subject.roleInSim,
      name: subject.name,
      role_label: subject.roleLabel,
      personality: subject.personality,
      values: subject.values,
      baseline_output: subject.baselineOutput,
    },
    partner: partner
      ? {
          id: partner.id,
          name: partner.name,
          role_in_sim: partner.roleInSim,
          role_label: partner.roleLabel,
        }
      : null,
    rounds,
    interactions: drilldownInteractions,
  };
}

