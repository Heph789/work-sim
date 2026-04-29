// HTTP route for the avatar drilldown view.
//
//   GET /runs/:id/avatars/:avatarId       full feed for the subject avatar
//   GET /runs/:id/avatars/:avatarId?partner=<id>
//                                         filtered to the subject↔partner pair
//
// Polled by the avatar-detail view at the same cadence as the dashboard
// (~2s) while the run is non-terminal.
//
// Privacy: this route handler is the choke point that enforces the
// self_perception privacy rule. Subject avatar's own self_perception flows
// through `rounds[]`. Other avatars' self_perception is dropped at the
// `toAvatarDetail` shaper so the API can never accidentally surface another
// avatar's inner monologue.

import type { FastifyPluginAsync } from 'fastify';

import type { AppDb } from '../db/index.js';
import {
  AvatarDrilldownQuerySchema,
  toAvatarDetail,
} from './schemas.js';

export interface AvatarsRouteDeps {
  db: AppDb;
}

export const avatarsRoutes: FastifyPluginAsync<AvatarsRouteDeps> = async (
  app,
  opts,
) => {
  const { db } = opts;

  app.get<{ Params: { id: string; avatarId: string } }>(
    '/runs/:id/avatars/:avatarId',
    async (req, reply) => {
      const { id: runId, avatarId } = req.params;
      const queryParsed = AvatarDrilldownQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        reply.code(400);
        return { error: 'invalid query', details: queryParsed.error.flatten() };
      }

      const runRow = await db.runs.byId(runId);
      if (!runRow) {
        reply.code(404);
        return { error: 'run not found' };
      }

      const subject = await db.avatars.byId(avatarId);
      if (!subject || subject.runId !== runId) {
        reply.code(404);
        return { error: 'avatar not found in this run' };
      }

      const partnerId = queryParsed.data.partner ?? null;
      let partner = null as Awaited<ReturnType<typeof db.avatars.byId>> | null;
      if (partnerId !== null) {
        partner = (await db.avatars.byId(partnerId)) ?? null;
        if (!partner || partner.runId !== runId) {
          reply.code(404);
          return { error: 'partner not found in this run' };
        }
      }

      // Subject's per-round state (drives `rounds[]` with private fields).
      const subjectRoundAvatars = await db.roundAvatars.byAvatar(
        runId,
        avatarId,
      );

      // Interaction feed: full subject feed when no partner filter; pair
      // filter when ?partner=… was provided.
      const interactions = partner
        ? await db.interactions.byPair(runId, subject.id, partner.id)
        : await db.interactions.byAvatar(runId, avatarId);

      // Resolve all avatars in the run so the shaper can attach
      // initiator/responder names without per-row lookups.
      const allAvatars = await db.avatars.byRunId(runId);
      const avatarsById = new Map(allAvatars.map((a) => [a.id, a]));

      // TODO: situation_tag for `rounds[i].situation_tag` lives on `round`,
      // not `round_avatar`. The shaper currently leaves it as ''. Either:
      //   - add a join in db.roundAvatars.byAvatar; or
      //   - pass a parallel rounds map into toAvatarDetail.
      // Both are fine; pick one when filling the TODO.

      return toAvatarDetail({
        subject,
        partner,
        subjectRoundAvatars,
        interactions,
        avatarsById,
      });
    },
  );
};
