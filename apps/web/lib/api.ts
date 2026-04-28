// Thin HTTP client for the Fastify API. Exists so every fetch goes through one
// place that knows the base URL and the wire types — components and hooks
// import these helpers instead of constructing fetch calls inline.
//
// Wire shapes are imported from @work-sim/shared so we never re-declare them.

import type {
  AgentProfile,
  RunDetail,
  RunListItem,
} from '@work-sim/shared';

/**
 * Base URL of the Fastify API. Read from NEXT_PUBLIC_API_URL at module load.
 * Fallback is the API's default dev port. The `NEXT_PUBLIC_` prefix is what
 * makes Next inline the value into the client bundle.
 */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Body shape for POST /runs. Mirrors apps/api/src/routes/schemas.ts CreateRunRequestSchema. */
export interface CreateRunBody {
  agents: AgentProfile[];
  target_paper: number;
  rounds_total: number;
  model?: string;
  temperature?: number;
}

/** Response shape for GET /runs. */
export interface ListRunsResponse {
  runs: RunListItem[];
  next_cursor: number | null;
}

/**
 * GET /runs — list runs newest first. The list page polls this every 5s while
 * any row is non-terminal (see hooks/use-runs.ts).
 */
export async function listRuns(opts?: { limit?: number; cursor?: number }): Promise<ListRunsResponse> {
  // TODO: build query string from opts; call fetch(`${API_BASE}/runs?...`).
  void opts;
  throw new Error('not implemented');
}

/**
 * GET /runs/:id — full run detail with all completed rounds. Polled every 2s
 * by the run-detail screen while status is pending|running.
 */
export async function getRun(id: string): Promise<RunDetail> {
  // TODO: fetch(`${API_BASE}/runs/${encodeURIComponent(id)}`); 404 → throw RunNotFound.
  void id;
  throw new Error('not implemented');
}

/**
 * POST /runs — create a new run. Returns the new run id, which the setup
 * screen uses to navigate to /runs/:id.
 */
export async function createRun(body: CreateRunBody): Promise<{ id: string }> {
  // TODO: POST JSON; on 400 throw with details from the response body.
  void body;
  throw new Error('not implemented');
}

/** Distinct error type so callers can branch on "polling target disappeared" vs transient errors. */
export class RunNotFoundError extends Error {
  // TODO: extend Error with the run id field.
}
