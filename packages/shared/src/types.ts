// Cross-boundary type definitions. These are the *wire shapes* — what the API
// returns and what the web app renders. They intentionally mirror the DB
// columns but are not the Drizzle row types directly: the DB stores
// `config_json` as a TEXT blob, while the API returns it as a parsed object.
//
// Keeping these in @work-sim/shared means the frontend can import them and
// know exactly what GET /runs/:id returns without re-declaring shapes.
//
// Naming: this iteration replaces the prior "agent" terminology with "avatar"
// across the wire (matches the runtime/DB rename in
// docs/many-workers/design.md §Terminology).

// ─────────────────────────────────────────────────────────────────────────────
// Avatar profiles & roles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two roles a participating avatar can hold in a run. v1: exactly one
 * 'manager' per run, N≥1 'worker' avatars all reporting to that manager.
 * The schema is symmetric across these two — same columns either way — but
 * the engine only updates worker-side morale. See design.md §1, §10.
 */
export type AvatarRole = 'manager' | 'worker';

/**
 * Snapshot of a single avatar's profile, as captured at run-creation time.
 * Lives inside `run.config_json.avatars[]`. Free-form text fields per
 * design.md §Terminology + the prototype's preset model.
 */
export interface AvatarProfile {
  /** Either 'manager' or 'worker'; v1 requires exactly one manager per run. */
  role_in_sim: AvatarRole;

  /** Display name, 1–80 chars. Used in prompts and UI. */
  name: string;

  /** Free-form job title, e.g. "Regional Manager". 1–80 chars. */
  role_label: string;

  /** Free-form personality description. 1–2000 chars. Goes into the prompt. */
  personality: string;

  /** Free-form values description. 1–2000 chars. Goes into the prompt. */
  values: string;

  /**
   * Integer 1–100. Multiplied by `morale / 50` to get paper_sold per round
   * (so morale=50 → output=baseline; morale=100 → 2× baseline). Unused for
   * managers in v1 — schema is symmetric, behavior is asymmetric.
   */
  baseline_output: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The immutable input snapshot persisted as JSON text in `run.config_json`.
 * Anything that can vary the output of a run lives here so that two runs with
 * identical config_json values are exactly comparable as experiment replicates.
 *
 * Discipline: when adding a new variance source, add it to this shape. The
 * shape stays loose during prototype.
 */
export interface RunConfig {
  /** 1 manager + N≥1 workers. Order is the deterministic worker iteration order. */
  avatars: AvatarProfile[];

  /** Provider model id, e.g. 'gpt-4.1'. Passed per-call to the LLMClient. */
  model: string;

  /** Sampling temperature; default 0.8. */
  temperature: number;

  /** Top-p; defaults to 1.0. */
  top_p: number;

  /** Bumped whenever prompt skeletons change. Captured for reproducibility. */
  prompt_template_version: string;

  /** Seed for deterministic situation_tag picking and pair sampling. */
  situation_tag_seed: number;

  /** Bumped whenever runner / scoring logic changes. Reproducibility tag. */
  sim_engine_version: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allowed values of the `run.status` column. State machine is enforced by the
 * runner (no DB triggers). 'cancelled' is a reserved slot — not exposed in v1
 * but already legal in the schema so flipping it on later is not a migration.
 */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ─────────────────────────────────────────────────────────────────────────────
// Per-run wire shapes returned by GET /runs/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire shape for one row in `avatar`. Returned alongside `RunDetail.avatars`
 * so the dashboard can render names without re-parsing config_json.
 *
 * `id` is the canonical avatar id used everywhere else in the wire shape
 * (FK target on round_avatar / interaction).
 */
export interface AvatarView extends AvatarProfile {
  /** Stable per-run avatar id. Used as FK in round_avatar / interaction. */
  id: string;
}

/**
 * Wire shape for a single round. Slimmed from the prior prototype: per-avatar
 * fields moved to `RoundAvatarView`. Per design.md §11 schema, the row only
 * carries the round-wide situation tag.
 */
export interface RoundView {
  round_index: number;
  situation_tag: string;
  created_at: number;
}

/**
 * End-of-round per-avatar state. One row per (round, avatar) — drives the
 * dashboard's morale curve and per-round paper-sold values.
 *
 * For managers in v1, `morale` / `morale_rationale` / `self_perception` /
 * `paper_sold` are all NULL (engine doesn't update manager state).
 */
export interface RoundAvatarView {
  round_index: number;
  avatar_id: string;
  morale: number | null;
  morale_rationale: string | null;
  self_perception: string | null;
  paper_sold: number | null;
  created_at: number;
}

/**
 * One LLM exchange — either a manager↔worker 1:1 or a worker↔worker peer
 * convo. Manager-vs-peer is derived from participants' roles (no `phase`
 * column per design.md §2).
 *
 * Initiator-side morale fields are NULL when the initiator is the manager
 * (manager has no morale in v1, design.md §15).
 */
export interface InteractionView {
  id: string;
  round_index: number;
  /** 0-based ordinal across the entire round; sorts manager phase before peer phase. */
  order_in_round: number;
  /** Denormalized from round.situation_tag — convenient for filtering. */
  situation_tag: string;

  initiator_avatar_id: string;
  responder_avatar_id: string;

  initiator_message: string;
  responder_message: string;

  initiator_morale: number | null;
  initiator_morale_rationale: string | null;
  initiator_self_perception: string | null;

  responder_morale: number;
  responder_morale_rationale: string;
  responder_self_perception: string;

  created_at: number;
}

/**
 * Full run detail returned by `GET /runs/:id`. Polled every 2s by the
 * dashboard while status is pending|running.
 *
 * Fan-out shape: avatars + rounds + per-(round, avatar) state +
 * interactions. The frontend reshapes these into per-avatar timelines on
 * the client; the API stays a single GET.
 *
 * Note: situation_tag_seed is intentionally omitted — it's an internal detail.
 */
export interface RunDetail {
  id: string;
  created_at: number;
  status: RunStatus;
  rounds_total: number;
  rounds_completed: number;
  target_paper: number;
  paper_total: number;
  experiment_id: string | null;
  config: Omit<RunConfig, 'situation_tag_seed'>;

  /** All avatars in the run, in deterministic order (manager first). */
  avatars: AvatarView[];

  /** Completed rounds, ascending by round_index. */
  rounds: RoundView[];

  /** End-of-round per-avatar snapshots. (round_index, avatar_id) UNIQUE. */
  round_avatars: RoundAvatarView[];

  /** All interactions across all completed rounds, sorted by (round_index, order_in_round). */
  interactions: InteractionView[];

  /** Populated only when status='failed'. */
  error_message: string | null;
  failed_at_round: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs list (GET /runs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One entry in the `GET /runs` list response. Denormalizes manager_name and
 * worker counts out of config_json so the frontend can render rows without
 * parsing the snapshot blob.
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
  manager_name: string;
  /** Number of worker avatars on this run (≥1). */
  n_workers: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create run (POST /runs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Body shape for `POST /runs`. Validation lives in apps/api/src/routes/schemas.ts;
 * this type is the post-validation shape the route handler receives.
 *
 * Constraints (enforced by the schema, not the type):
 * - Exactly one manager in `avatars`.
 * - At least one worker in `avatars`.
 * - All worker `baseline_output` ≥ 1.
 */
export interface CreateRunRequest {
  avatars: AvatarProfile[];
  target_paper: number;
  rounds_total: number;
  /** Defaults to 'gpt-4.1' if omitted. */
  model?: string;
  /** Defaults to 0.8 if omitted. */
  temperature?: number;
}
