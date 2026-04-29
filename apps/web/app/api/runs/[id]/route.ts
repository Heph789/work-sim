// Route: /api/runs/[id]
// Method: GET (detail). Returns 404 for unknown ids — matches the real
// Fastify API's contract so the frontend's RunNotFoundError path triggers.

import type { RunDetail } from '@work-sim/shared';
import {
  resolveScenario,
  setCookieHeader,
} from '@/lib/mock/scenario-cookie';
import { getRun } from '@/lib/mock/store';
import type { MockRun } from '@/lib/mock/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  const { scenario, setCookie } = resolveScenario(req);
  const run = getRun(scenario, id);

  const headers: HeadersInit = {};
  if (setCookie) headers['Set-Cookie'] = setCookieHeader(scenario);

  if (!run) {
    return Response.json(
      { error: 'run not found' },
      { status: 404, headers },
    );
  }
  return Response.json(toDetail(run), { headers });
}

/** Strip the internal `tick_started_at` before sending over the wire. */
function toDetail(run: MockRun): RunDetail {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tick_started_at, ...detail } = run;
  return detail;
}
