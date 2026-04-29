// Route: /api/runs/[id]/avatars/[avatarId]?partner=<id>
// Method: GET. Returns AvatarDetail — the per-avatar drilldown payload
// (subject profile + per-round entries with private fields + interaction
// feed). Optional `partner` filters interactions to a specific pair in
// either direction.
//
// 404 if the run is unknown OR if the avatarId is not part of the run —
// matches the real API's contract so the frontend's RunNotFoundError path
// triggers in either case.

import type {
  AvatarDetail,
  DrilldownInteraction,
} from '@work-sim/shared';
import {
  resolveScenario,
  setCookieHeader,
} from '@/lib/mock/scenario-cookie';
import { getRun } from '@/lib/mock/store';

interface RouteContext {
  params: Promise<{ id: string; avatarId: string }>;
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const { id, avatarId } = await ctx.params;
  const url = new URL(req.url);
  const partnerId = url.searchParams.get('partner');
  const { scenario, setCookie } = resolveScenario(req);
  const run = getRun(scenario, id);

  const headers: HeadersInit = {};
  if (setCookie) headers['Set-Cookie'] = setCookieHeader(scenario);

  if (!run) {
    return Response.json({ error: 'run not found' }, { status: 404, headers });
  }

  const subject = run._drilldown.avatarProfiles[avatarId];
  if (!subject) {
    return Response.json({ error: 'avatar not in run' }, { status: 404, headers });
  }

  // Filter interactions to those involving the subject (and optionally a
  // specific partner, in either direction).
  const interactions: DrilldownInteraction[] = run._drilldown.interactions.filter((it) => {
    const involvesSubject = it.initiator.id === avatarId || it.responder.id === avatarId;
    if (!involvesSubject) return false;
    if (partnerId) {
      const partnerSide = it.initiator.id === avatarId ? it.responder.id : it.initiator.id;
      if (partnerSide !== partnerId) return false;
    }
    return true;
  });

  let partner: AvatarDetail['partner'] = null;
  if (partnerId) {
    const profile = run._drilldown.avatarProfiles[partnerId];
    if (profile) {
      partner = {
        id: profile.id,
        name: profile.name,
        role_in_sim: profile.role_in_sim,
        role_label: profile.role_label,
      };
    }
  }

  const detail: AvatarDetail = {
    avatar: subject,
    partner,
    rounds: run._drilldown.roundEntries[avatarId] ?? [],
    interactions,
  };
  return Response.json(detail, { headers });
}
