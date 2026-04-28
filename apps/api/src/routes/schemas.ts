// HTTP request validation schemas + response shapers. Anything coming from
// the network is validated here before hitting the engine. Centralizing
// also means the OpenAPI / typed-client story (when we want it) has one place
// to look.
//
// Bounds rationale lives in docs/initial-prototype/api.md.

import { z } from 'zod';

import type {
  AgentProfile,
  RunConfig,
  RunDetail,
  RunListItem,
  RoundView,
  RunStatus,
} from '@work-sim/shared';

/** Per-agent shape — must match AgentProfile + the bounds in api.md. */
export const AgentProfileSchema = z.object({
  role_in_sim: z.enum(['manager', 'worker']),
  name: z.string().min(1).max(80),
  role_label: z.string().min(1).max(80),
  personality: z.string().min(1).max(2000),
  values: z.string().min(1).max(2000),
  baseline_output: z.number().int().min(1).max(100),
});

/**
 * Body of POST /runs. Refined to require exactly one manager + one worker —
 * this is a v1 invariant that the runner relies on.
 */
export const CreateRunRequestSchema = z
  .object({
    agents: z.array(AgentProfileSchema).length(2),
    target_paper: z.number().int().min(1),
    rounds_total: z.number().int().min(1).max(100),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .refine(
    (b) =>
      b.agents.filter((a) => a.role_in_sim === 'manager').length === 1 &&
      b.agents.filter((a) => a.role_in_sim === 'worker').length === 1,
    { message: 'agents must contain exactly one manager and one worker' },
  );

/** Query string for GET /runs pagination. */
export const ListRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** created_at unix-ms cursor (rows strictly older than this are returned). */
  cursor: z.coerce.number().int().nullable().optional(),
});

// ── Response shapers ────────────────────────────────────────────────────────
// These convert DB row shapes (snake_case via Drizzle column mappings, plus
// `config_json` as a TEXT blob) into the wire shapes the frontend expects.

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

export interface RoundRowLike {
  roundIndex: number;
  situationTag: string;
  managerMessage: string;
  workerMessage: string;
  workerSelfPerception: string;
  workerMoraleRationale: string;
  morale: number;
  paperSold: number;
  createdAt: number;
}

/** Project a runs row → list-item shape. Pulls names out of config_json. */
export function toRunListItem(row: RunRowLike): RunListItem {
  const config = JSON.parse(row.configJson) as RunConfig;
  const manager = config.agents.find((a: AgentProfile) => a.role_in_sim === 'manager');
  const worker = config.agents.find((a: AgentProfile) => a.role_in_sim === 'worker');
  return {
    id: row.id,
    created_at: row.createdAt,
    status: row.status,
    rounds_total: row.roundsTotal,
    rounds_completed: row.roundsCompleted,
    target_paper: row.targetPaper,
    paper_total: row.paperTotal,
    hit_target: row.status === 'completed' ? row.paperTotal >= row.targetPaper : null,
    manager_name: manager?.name ?? '',
    worker_name: worker?.name ?? '',
  };
}

/** Project a runs row + its rounds → full detail shape. */
export function toRunDetail(args: { run: RunRowLike; rounds: RoundRowLike[] }): RunDetail {
  const { run, rounds } = args;
  const config = JSON.parse(run.configJson) as RunConfig;
  // situation_tag_seed is intentionally stripped — internal detail.
  const { situation_tag_seed: _seed, ...publicConfig } = config;
  void _seed;
  return {
    id: run.id,
    created_at: run.createdAt,
    status: run.status,
    rounds_total: run.roundsTotal,
    rounds_completed: run.roundsCompleted,
    target_paper: run.targetPaper,
    paper_total: run.paperTotal,
    experiment_id: run.experimentId,
    config: publicConfig,
    rounds: rounds.map(toRoundView),
    error_message: run.errorMessage,
    failed_at_round: run.failedAtRound,
  };
}

/** Project a single round row → wire-shaped RoundView. */
export function toRoundView(row: RoundRowLike): RoundView {
  return {
    round_index: row.roundIndex,
    situation_tag: row.situationTag,
    manager_message: row.managerMessage,
    worker_message: row.workerMessage,
    worker_self_perception: row.workerSelfPerception,
    worker_morale_rationale: row.workerMoraleRationale,
    morale: row.morale,
    paper_sold: row.paperSold,
    created_at: row.createdAt,
  };
}
