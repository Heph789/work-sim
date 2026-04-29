// Thin HTTP client for the Fastify API. Exists so every fetch goes through one
// place that knows the base URL and the wire types — components and hooks
// import these helpers instead of constructing fetch calls inline.
//
// Wire shapes are imported from @work-sim/shared so we never re-declare them.

import type {
  AgentProfile,
  RunDetail,
  RunInteractionsFeed,
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

/** Distinct error type so callers can branch on "polling target disappeared" vs transient errors. */
export class RunNotFoundError extends Error {
  readonly runId: string;
  constructor(runId: string) {
    super(`run not found: ${runId}`);
    this.name = 'RunNotFoundError';
    this.runId = runId;
  }
}

/** Thrown for non-2xx responses other than 404 on getRun. Carries server-supplied detail. */
export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Read a JSON body if there is one; tolerate empty/non-JSON for non-2xx errors. */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * GET /runs — list runs newest first. The list page polls this every 5s while
 * any row is non-terminal (see hooks/use-runs.ts).
 */
export async function listRuns(opts?: { limit?: number; cursor?: number }): Promise<ListRunsResponse> {
  const qs = new URLSearchParams();
  if (opts?.limit !== undefined) qs.set('limit', String(opts.limit));
  if (opts?.cursor !== undefined && opts.cursor !== null) qs.set('cursor', String(opts.cursor));
  const url = `${API_BASE}/runs${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await readJson(res);
    throw new ApiError(res.status, `GET /runs failed (${res.status})`, body);
  }
  return (await res.json()) as ListRunsResponse;
}

/**
 * GET /runs/:id — full run detail with all completed rounds. Polled every 2s
 * by the run-detail screen while status is pending|running.
 */
export async function getRun(id: string): Promise<RunDetail> {
  const res = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) throw new RunNotFoundError(id);
  if (!res.ok) {
    const body = await readJson(res);
    throw new ApiError(res.status, `GET /runs/${id} failed (${res.status})`, body);
  }
  return (await res.json()) as RunDetail;
}

/**
 * GET /runs/:id/interactions — full interaction timeline ordered by
 * (round_index, order_in_round). `self_perception` is stripped server-side.
 */
export async function getRunInteractions(id: string): Promise<RunInteractionsFeed> {
  const res = await fetch(
    `${API_BASE}/runs/${encodeURIComponent(id)}/interactions`,
    { headers: { Accept: 'application/json' } },
  );
  if (res.status === 404) throw new RunNotFoundError(id);
  if (!res.ok) {
    const body = await readJson(res);
    throw new ApiError(
      res.status,
      `GET /runs/${id}/interactions failed (${res.status})`,
      body,
    );
  }
  return (await res.json()) as RunInteractionsFeed;
}

/**
 * POST /runs — create a new run. Returns the new run id, which the setup
 * screen uses to navigate to /runs/:id.
 */
export async function createRun(body: CreateRunBody): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await readJson(res);
  if (!res.ok) {
    const detail =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `POST /runs failed (${res.status})`;
    throw new ApiError(res.status, detail, payload);
  }
  return payload as { id: string };
}
