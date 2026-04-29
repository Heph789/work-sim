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
  initiatorMorale: number | null;
  initiatorMoraleRationale: string | null;
  responderMorale: number;
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
  // TODO: assemble per docs/many-workers/api.md.
  //
  // Steps:
  //   1. Parse config_json; strip situation_tag_seed.
  //   2. team_expected = helpers.teamExpected({...}); team_delta = signedDelta(...).
  //   3. Group roundAvatars by round_index → rounds[i].avatars[].
  //   4. For each avatar: build morale_curve / paper_per_round arrays
  //      (length = rounds_completed, in round_index order). Pull last_morale
  //      from the most recent non-null entry. paper_total = sum(paper_per_round).
  //      For workers also compute worker_expected_share + worker_delta.
  //   5. Return the full RunDetail shape.
  void args;
  return null as unknown as RunDetail;
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
}): AvatarDetail {
  const { subject, partner, subjectRoundAvatars, interactions, avatarsById } =
    args;

  const rounds: DrilldownRoundEntry[] = subjectRoundAvatars.map((r) => ({
    round_index: r.roundIndex,
    // TODO: situation_tag isn't on round_avatar; route handler must supply
    // it via a separate join with the round table OR via a parallel
    // round-row map. Threading that here keeps this shaper pure.
    situation_tag: '',
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
        initiator_morale: it.initiatorMorale,
        initiator_morale_rationale: it.initiatorMoraleRationale,
        responder_morale: it.responderMorale,
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

// DashboardRound, DashboardRoundAvatar, DashboardPerAvatar are imported as
// types only — they're consumed inside `toRunDetail`'s TODO body when the
// dashboard aggregation is filled in. No runtime references needed here.
