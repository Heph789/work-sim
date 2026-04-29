// Thin HTTP client for the Fastify API. Exists so every fetch goes through one
// place that knows the base URL and the wire types — components and hooks
// import these helpers instead of constructing fetch calls inline.
//
// Wire shapes are imported from @work-sim/shared so we never re-declare them.

import type {
  AvatarDetail,
  AvatarProfile,
  RunDetail,
  RunInteractionsFeed,
  RunListItem,
} from '@work-sim/shared';

/**
 * Base URL of the runs API.
 *
 * Two modes:
 * - Mock mode (default while NEXT_PUBLIC_USE_MOCK is unset OR === 'true'):
 *   point at the same-origin Next route handlers under `/api`. No real
 *   backend required — the dev server serves both the UI and the API.
 *   See apps/web/app/api/runs/* and apps/web/lib/mock/*.
 * - Real mode (NEXT_PUBLIC_USE_MOCK === 'false'): fall through to the
 *   Fastify API URL in NEXT_PUBLIC_API_URL (default :4000).
 *
 * The `NEXT_PUBLIC_` prefix is what makes Next inline the value into the
 * client bundle.
 */
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== 'false';
export const API_BASE: string = USE_MOCK
  ? '/api'
  : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');

/**
 * In mock mode, propagate `?scenario=…` from the page URL onto every API
 * fetch. Without this the route handler only sees the query when the user
 * navigates with it directly; client-side polling fetches strip it. The route
 * handler also Set-Cookies the chosen scenario so subsequent navigations
 * (e.g. into a run dashboard whose URL has no query) keep using it.
 */
function withScenario(url: string): string {
  if (!USE_MOCK || typeof window === 'undefined') return url;
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  if (!scenario) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}scenario=${encodeURIComponent(scenario)}`;
}

/**
 * Body shape for POST /runs. Mirrors apps/api/src/routes/schemas.ts
 * CreateRunRequestSchema. The setup page builds this from its draft and
 * passes it to `createRun`.
 *
 * Constraints (validated server-side):
 * - exactly one manager in `avatars`
 * - at least one worker in `avatars`
 */
export interface CreateRunBody {
  /** No `id` — the API generates uuids server-side and stores them in
   *  both the avatar table and the config_json snapshot. */
  avatars: Array<Omit<AvatarProfile, 'id'>>;
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
  // TODO: trim once the API guarantees JSON content-type on non-2xx
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
  const res = await fetch(withScenario(url), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await readJson(res);
    throw new ApiError(res.status, `GET /runs failed (${res.status})`, body);
  }
  return (await res.json()) as ListRunsResponse;
}

/**
 * GET /runs/:id — dashboard-aggregated run detail (per-round + per-avatar
 * snapshots). No interactions — those live on the per-avatar drilldown
 * endpoint (design.md §14.1). Polled every 2s by the dashboard while
 * status is pending|running.
 */
export async function getRun(id: string): Promise<RunDetail> {
  const res = await fetch(withScenario(`${API_BASE}/runs/${encodeURIComponent(id)}`), {
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
 * GET /runs/:id/avatars/:avatarId — per-avatar drilldown feed. Includes
 * private fields (rationale, self_perception) for the subject avatar only;
 * other participants' private state is filtered out. Optional `partner`
 * narrows the interactions list to a specific pair (in either direction).
 */
export async function fetchAvatarDetail(
  runId: string,
  avatarId: string,
  partner?: string,
): Promise<AvatarDetail> {
  const qs = partner ? `?partner=${encodeURIComponent(partner)}` : '';
  const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/avatars/${encodeURIComponent(avatarId)}${qs}`;
  const res = await fetch(withScenario(url), { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new RunNotFoundError(`${runId}/${avatarId}`);
  if (!res.ok) {
    const body = await readJson(res);
    throw new ApiError(res.status, `GET ${url} failed (${res.status})`, body);
  }
  return (await res.json()) as AvatarDetail;
}

/**
 * POST /runs — create a new run. Returns the new run id, which the setup
 * screen uses to navigate to /runs/:id.
 */
export async function createRun(body: CreateRunBody): Promise<{ id: string }> {
  const res = await fetch(withScenario(`${API_BASE}/runs`), {
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
