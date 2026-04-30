// Cross-boundary type definitions for the many-workers iteration. These are
// the *wire shapes* — what the API returns and what the web app renders.
// They mirror the DB columns but are not the Drizzle row types directly:
// the DB stores `config_json` as TEXT, while the API returns it as a parsed
// object; the dashboard read aggregates per-avatar stats that don't live on
// any single row.
//
// "Avatar" replaces the prototype's "agent" everywhere — code, types,
// prompts, docs. See docs/many-workers/design.md §Terminology.

/**
 * The two roles an avatar can hold in a run. v1 is exactly one manager + N≥1
 * workers; the schema and types are symmetric so adding a third role later
 * (e.g. 'customer') is additive.
 */
export type AvatarRole = 'manager' | 'worker';

/**
 * Morale every worker starts at, before round 1's first interaction. 50 is
 * the engine's neutral baseline (see scoring.ts: morale=50 → output=baseline).
 * Single source of truth for the runner, the mock fabricator, and the UI's
 * "starting morale" annotations on the chart + interactions header.
 */
export const STARTING_MORALE = 50;

/**
 * Snapshot of a single avatar's profile, as captured at run-creation time.
 * Lives both in `avatar` table rows AND inside `run.config_json.avatars[]`.
 * The table is the queryable canonical for FKs; the snapshot is what
 * guarantees experimental reproducibility.
 */
export interface AvatarProfile {
  /**
   * uuid; identical between the avatar row and the config_json snapshot. The
   * frontend uses this to wire up drilldown links from the dashboard.
   */
  id: string;

  /** 'manager' or 'worker'. v1 requires exactly one manager + ≥1 workers. */
  role_in_sim: AvatarRole;

  /** Display name. 1–80 chars; unique within the run (validator-enforced). */
  name: string;

  /** Free-form job title, e.g. "Regional Manager". 1–80 chars. */
  role_label: string;

  /** Free-form personality description. 1–2000 chars. Goes into the prompt. */
  personality: string;

  /** Free-form values description. 1–2000 chars. Goes into the prompt. */
  values: string;

  /**
   * Integer. For workers: 1–100, multiplied by `morale / 50` per round. For
   * managers: 0 or 1, ignored (v1 doesn't compute manager output). The
   * manager prompt deliberately never sees baseline_output of any avatar —
   * see docs/many-workers/design.md §7 manager information asymmetry.
   */
  baseline_output: number;
}

/**
 * The immutable input snapshot persisted as JSON text in `run.config_json`.
 * Anything that can vary the output of a run lives here. Two runs with
 * identical config_json values are exactly comparable as experiment
 * replicates.
 */
export interface RunConfig {
  /** ≥2 entries: exactly one manager + ≥1 worker. */
  avatars: AvatarProfile[];

  /** Provider model id, e.g. 'gpt-4o-mini'. Per-call to the LLMClient. */
  model: string;

  /** Sampling temperature; default 0.8. */
  temperature: number;

  /** Top-p; default 1.0. */
  top_p: number;

  /** Bumped whenever any prompt skeleton changes. Reproducibility tag. */
  prompt_template_version: string;

  /** Seed for deterministic situation_tag picking + pair sampling. */
  situation_tag_seed: number;

  /** Bumped whenever runner / scoring logic changes. Reproducibility tag. */
  sim_engine_version: string;
}

/**
 * Allowed values of the `run.status` column. Enforced by the runner.
 * 'cancelled' is a reserved slot — not exposed as an endpoint in v1 but
 * already legal in the schema, so flipping it on later is not a migration.
 */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ─── Wire shapes for read endpoints ─────────────────────────────────────────
// These are denormalized on the API side so the frontend can render without
// joining or re-deriving. See docs/many-workers/api.md.

/**
 * Signed delta from an expected value. Used in the dashboard to render
 * "team is 12 units below expected" / "Jim is 3 units above expected share."
 */
export interface SignedDelta {
  /** Absolute magnitude — always ≥0. */
  abs: number;
  /** 'above' when actual ≥ expected; 'below' otherwise. */
  direction: 'above' | 'below';
}

/**
 * One entry in the `GET /runs` list response. Denormalizes the manager and
 * worker names out of config_json so list rendering never parses the snapshot.
 */
export interface RunListItem {
  id: string;
  created_at: number;
  status: RunStatus;
  rounds_total: number;
  rounds_completed: number;
  target_paper: number;
  paper_total: number;
  /** True/false once status is 'completed'; null while non-terminal. */
  hit_target: boolean | null;
  /** Pulled from the manager avatar row. */
  manager_name: string;
  /** All worker names in config_json order. */
  worker_names: string[];
}

/**
 * Per-round, per-avatar snapshot returned in the dashboard read. Mirrors a
 * `round_avatar` row but only the fields the dashboard needs. Drilldown
 * exposes the rest (rationale, self_perception) under the privacy filter.
 */
export interface DashboardRoundAvatar {
  avatar_id: string;
  morale: number | null;
  paper_sold: number | null;
}

/**
 * Per-round entry in the dashboard read. No interaction text — drilldown
 * fetches that. Aggregates per-avatar end-of-round state.
 */
export interface DashboardRound {
  round_index: number;
  situation_tag: string;
  created_at: number;
  avatars: DashboardRoundAvatar[];
}

/**
 * Per-avatar aggregate row in the dashboard read. Drives the per-avatar
 * tiles: cumulative paper, last-round morale, sparkline data.
 */
export interface DashboardPerAvatar {
  avatar_id: string;
  name: string;
  role_in_sim: AvatarRole;
  role_label: string;
  /** NULL for the manager — managers don't sell paper in v1. */
  paper_total: number | null;
  /** target_paper / num_workers × rounds_completed / rounds_total. NULL for manager. */
  worker_expected_share: number | null;
  /** paper_total - worker_expected_share. NULL for manager. */
  worker_delta: SignedDelta | null;
  /** Last completed round's morale; NULL on round 0 or for the manager. */
  last_morale: number | null;
  /** One entry per completed round, oldest → newest. NULL where absent (e.g. manager). */
  morale_curve: Array<number | null>;
  /** Same length as `morale_curve`. NULL for manager rounds. */
  paper_per_round: Array<number | null>;
}

/**
 * Full dashboard payload returned by `GET /runs/:id`. Polled by the dashboard
 * view every 2s while status is non-terminal. Stripped of all interaction
 * text and self_perception — those are private and large; drilldown fetches
 * what it needs.
 */
export interface RunDetail {
  id: string;
  created_at: number;
  status: RunStatus;
  rounds_total: number;
  rounds_completed: number;
  target_paper: number;
  paper_total: number;
  /** round(target_paper * rounds_completed / rounds_total). */
  team_expected: number;
  team_delta: SignedDelta;
  experiment_id: string | null;
  /** Public subset of RunConfig — `situation_tag_seed` deliberately omitted. */
  config: Omit<RunConfig, 'situation_tag_seed'>;
  rounds: DashboardRound[];
  per_avatar: DashboardPerAvatar[];
  error_message: string | null;
  failed_at_round: number | null;
}

/**
 * One per-round entry in the avatar drilldown. Includes private fields
 * (morale_rationale, self_perception) ONLY for the subject avatar; other
 * avatars' private state is never exposed.
 */
export interface DrilldownRoundEntry {
  round_index: number;
  situation_tag: string;
  morale: number | null;
  morale_rationale: string | null;
  self_perception: string | null;
  paper_sold: number | null;
}

/**
 * One interaction row as exposed in the drilldown feed. Both sides'
 * messages and emitted morale deltas are returned. The delta is the RAW
 * value the LLM emitted (signed integer in [-10, +10]), unweighted —
 * weighting is an engine-side accounting concern. Per-round running morale
 * (the absolute 0..100 number) lives on `DrilldownRoundEntry`.
 *
 * Privacy rule for self_perception: the LLM emits an `updated_self_perception`
 * on every reaction, so it changes per-interaction (not just per-round).
 * `subject_self_perception` carries the focused avatar's emitted value for
 * this interaction — and ONLY the subject's. The partner's stays private.
 * On the run-level interaction feed (no subject) it is always null.
 */
export interface DrilldownInteraction {
  id: string;
  round_index: number;
  order_in_round: number;
  situation_tag: string;
  initiator: { id: string; name: string; role_in_sim: AvatarRole };
  responder: { id: string; name: string; role_in_sim: AvatarRole };
  initiator_message: string;
  responder_message: string;
  /** NULL when initiator is the manager (managers don't track morale in v1). */
  initiator_morale_delta: number | null;
  initiator_morale_rationale: string | null;
  responder_morale_delta: number;
  responder_morale_rationale: string;
  /**
   * Subject avatar's `updated_self_perception` emitted in this interaction.
   * NULL when the subject didn't emit one here (e.g. they were the manager,
   * or they were the peer-initiator on the opening turn before the reflection).
   * NULL on the run-level feed since there is no subject.
   */
  subject_self_perception: string | null;
  created_at: number;
}

/**
 * Full drilldown payload returned by `GET /runs/:id/avatars/:avatarId`. When
 * the request includes `?partner=<id>`, the interaction feed is restricted to
 * that pair (in either direction) and `partner` is populated.
 */
export interface AvatarDetail {
  /** Subject avatar's full profile (incl. private values like baseline_output). */
  avatar: AvatarProfile;
  /** Populated only when `?partner=<id>` was provided. */
  partner: {
    id: string;
    name: string;
    role_in_sim: AvatarRole;
    role_label: string;
  } | null;
  /** Per-round state for the subject avatar; subject's private fields included. */
  rounds: DrilldownRoundEntry[];
  /** Interactions where subject was initiator or responder, ordered by (round_index, order_in_round). */
  interactions: DrilldownInteraction[];
}

/**
 * Response envelope for `GET /runs/:id/interactions`. Full interaction
 * timeline for the run, ordered by (round_index, order_in_round). Both sides'
 * `self_perception` are stripped — same privacy rule as the drilldown feed.
 */
export interface RunInteractionsFeed {
  interactions: DrilldownInteraction[];
}

// ─── Request body type ──────────────────────────────────────────────────────

/**
 * Body shape for `POST /runs`. The Zod validator in
 * apps/api/src/routes/schemas.ts owns the constraints; this type is what the
 * route handler receives post-validation. Note that `avatars[].id` is NOT
 * supplied by the client — the API generates uuids server-side and stores
 * them in both the avatar table and the config_json snapshot.
 */
export interface CreateRunRequest {
  avatars: Array<Omit<AvatarProfile, 'id'>>;
  target_paper: number;
  rounds_total: number;
  /** Defaults to 'gpt-4o-mini' if omitted. */
  model?: string;
  /** Defaults to 0.8 if omitted. */
  temperature?: number;
}
