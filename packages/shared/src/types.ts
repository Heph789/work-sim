// Cross-boundary type definitions. These are the *wire shapes* — what the API
// returns and what the web app renders. They intentionally mirror the DB
// columns but are not the Drizzle row types directly: the DB stores
// `config_json` as a TEXT blob, while the API returns it as a parsed object.
//
// Keeping these in @work-sim/shared means the frontend can import them and
// know exactly what GET /runs/:id returns without re-declaring shapes.

/**
 * The two roles a participating agent can hold in a run. The schema is
 * symmetric across these two — manager and worker rows have the same shape —
 * but the runner (v1) only updates worker-side morale / self-perception.
 */
export type AgentRole = 'manager' | 'worker';

/**
 * Snapshot of a single agent's profile, as captured at run-creation time.
 * Lives inside `runs.config_json.agents[]`. Free-form text fields per
 * locked-decisions.md #3; a structured taxonomy may be added alongside later.
 */
export interface AgentProfile {
  /** Either 'manager' or 'worker'; v1 requires exactly one of each per run. */
  role_in_sim: AgentRole;

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

/**
 * The immutable input snapshot persisted as JSON text in `runs.config_json`.
 * Anything that can vary the output of a run lives here so that two runs with
 * identical config_json values are exactly comparable as experiment replicates.
 *
 * Discipline (per locked-decisions.md #11): when adding a new variance source,
 * add it to this shape. The shape stays loose during prototype.
 */
export interface RunConfig {
  /** Exactly two agents in v1: one manager, one worker. */
  agents: AgentProfile[];

  /** Provider model id, e.g. 'gpt-4.1'. Passed per-call to the LLMClient. */
  model: string;

  /** Sampling temperature; default 0.8. */
  temperature: number;

  /** Top-p; defaults to 1.0. */
  top_p: number;

  /** Bumped whenever prompt skeletons change. Captured for reproducibility. */
  prompt_template_version: string;

  /** Seed for deterministic situation_tag picking; captured at run creation. */
  situation_tag_seed: number;

  /** Bumped whenever runner / scoring logic changes. Reproducibility tag. */
  sim_engine_version: string;
}

/**
 * Allowed values of the `runs.status` column. State machine is enforced by the
 * runner (no DB triggers). 'cancelled' is a reserved slot — not exposed in v1
 * but already legal in the schema so flipping it on later is not a migration.
 */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Wire shape for a single completed round, as returned by GET /runs/:id.
 * One-to-one with a `rounds` table row, minus internal id / run_id columns
 * that the client doesn't need.
 */
export interface RoundView {
  round_index: number;
  situation_tag: string;
  manager_message: string;
  worker_message: string;
  worker_self_perception: string;
  morale: number;
  paper_sold: number;
  created_at: number;
}

/**
 * One entry in the `GET /runs` list response. Denormalizes manager_name and
 * worker_name out of config_json so the frontend can render rows without
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
  worker_name: string;
}

/**
 * Full run detail returned by `GET /runs/:id`. Polled by the run-detail screen
 * every 2s while status is 'pending' or 'running'.
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
  /** Ordered ascending by round_index. */
  rounds: RoundView[];
  /** Populated only when status='failed'. */
  error_message: string | null;
  failed_at_round: number | null;
}

/**
 * Body shape for `POST /runs`. Validation lives in apps/api/src/routes/schemas.ts;
 * this type is the post-validation shape the route handler receives.
 */
export interface CreateRunRequest {
  agents: AgentProfile[];
  target_paper: number;
  rounds_total: number;
  /** Defaults to 'gpt-4.1' if omitted. */
  model?: string;
  /** Defaults to 0.8 if omitted. */
  temperature?: number;
}
