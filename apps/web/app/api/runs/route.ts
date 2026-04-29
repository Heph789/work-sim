// Route: /api/runs
// Methods: GET (list), POST (create)
//
// Same-origin mock backend used while the real Fastify API is unbuilt. The
// route is mounted under /api so the frontend can talk to it via plain
// relative URLs (see lib/api.ts NEXT_PUBLIC_USE_MOCK).
//
// Scenario selection: ?scenario=<name> picks; otherwise the mock-scenario
// cookie wins; otherwise 'default'. See lib/mock/scenario-cookie.ts.

import type {
  CreateRunRequest,
  RunDetail,
  RunListItem,
} from '@work-sim/shared';
import {
  resolveScenario,
  setCookieHeader,
} from '@/lib/mock/scenario-cookie';
import { addRun, buildRunFromRequest, getRuns } from '@/lib/mock/store';
import type { MockRun } from '@/lib/mock/types';

/** GET /api/runs → { runs: RunListItem[], next_cursor: number | null }. */
export async function GET(req: Request): Promise<Response> {
  const { scenario, setCookie } = resolveScenario(req);
  const runs = getRuns(scenario);
  const items: RunListItem[] = runs.map(toListItem);
  const headers: HeadersInit = {};
  if (setCookie) headers['Set-Cookie'] = setCookieHeader(scenario);
  return Response.json(
    { runs: items, next_cursor: null },
    { headers },
  );
}

/**
 * POST /api/runs → { id }. Body matches CreateRunRequest.
 * Validation is deliberately minimal — the real API does the strict zod check.
 * The mock just needs to keep the dev experience moving.
 */
export async function POST(req: Request): Promise<Response> {
  const { scenario, setCookie } = resolveScenario(req);

  let body: CreateRunRequest;
  try {
    body = (await req.json()) as CreateRunRequest;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body || !Array.isArray(body.avatars) || body.avatars.length < 2) {
    return Response.json(
      { error: 'avatars[] must contain a manager and at least one worker' },
      { status: 400 },
    );
  }
  if (typeof body.target_paper !== 'number' || typeof body.rounds_total !== 'number') {
    return Response.json(
      { error: 'target_paper and rounds_total are required numbers' },
      { status: 400 },
    );
  }

  const run = buildRunFromRequest(body);
  addRun(scenario, run);

  const headers: HeadersInit = {};
  if (setCookie) headers['Set-Cookie'] = setCookieHeader(scenario);
  return Response.json({ id: run.id }, { status: 201, headers });
}

/** Project a MockRun (which is a RunDetail + tick_started_at) into the list-row shape. */
function toListItem(run: MockRun): RunListItem {
  void (run satisfies RunDetail);
  const manager = run.avatars.find((a) => a.role_in_sim === 'manager');
  const nWorkers = run.avatars.filter((a) => a.role_in_sim === 'worker').length;
  const hitTarget =
    run.status === 'completed' ? run.paper_total >= run.target_paper : null;
  return {
    id: run.id,
    created_at: run.created_at,
    status: run.status,
    rounds_total: run.rounds_total,
    rounds_completed: run.rounds_completed,
    target_paper: run.target_paper,
    paper_total: run.paper_total,
    hit_target: hitTarget,
    manager_name: manager?.name ?? '(no manager)',
    n_workers: nWorkers,
  };
}
