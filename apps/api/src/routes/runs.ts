// HTTP routes for the runs resource. Thin: validate input, snapshot config,
// kick off the runner, expose read endpoints. No business logic beyond shape.
//
// Endpoints registered:
//   POST /runs                    — create a new run; fire-and-forget the runner.
//   GET  /runs                    — list newest-first, cursor-paginated.
//   GET  /runs/:id                — dashboard read (polled every 2s).
//   GET  /runs/:id/interactions   — full interaction timeline for the run.
//
// The avatar drilldown route lives in routes/avatars.ts.

import type { FastifyPluginAsync } from 'fastify';
import { v4 as uuid } from 'uuid';

import type { AvatarProfile, RunConfig } from '@work-sim/shared';

import type { AppDb } from '../db/index.js';
import type { Runner } from '../engine/runner.js';
import { SIM_ENGINE_VERSION } from '../engine/runner.js';
import { PROMPT_TEMPLATE_VERSION } from '../engine/prompts.js';
import {
  signedDelta,
  teamExpected,
  workerExpectedShare,
} from '../engine/scoring.js';
import {
  CreateRunRequestSchema,
  ListRunsQuerySchema,
  toRunListItem,
  toRunDetail,
  toRunInteractionsFeed,
} from './schemas.js';

/**
 * Dependencies the runs routes need at registration time. Passed via Fastify
 * plugin options so this file doesn't reach into a global container.
 */
export interface RunsRouteDeps {
  db: AppDb;
  runner: Runner;
}

/** Fastify default for `model` if omitted from the request. */
const DEFAULT_MODEL = 'gpt-4o-mini';
/** Fastify default for `temperature` if omitted. */
const DEFAULT_TEMPERATURE = 0.8;
/** Default top_p — captured into config_json even though not in the request. */
const DEFAULT_TOP_P = 1.0;

export const runsRoutes: FastifyPluginAsync<RunsRouteDeps> = async (
  app,
  opts,
) => {
  const { db, runner } = opts;

  // ── POST /runs ────────────────────────────────────────────────────────────
  // Validate avatars (1 manager + ≥1 workers, unique names), insert run +
  // avatar rows, snapshot config_json (with the newly-assigned avatar ids
  // baked in), fire-and-forget the runner, return 201 { id }.
  app.post('/runs', async (req, reply) => {
    const parsed = CreateRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request', details: parsed.error.flatten() };
    }
    const body = parsed.data;
    const runId = uuid();

    // Assign avatar uuids server-side. Both `avatar` rows and the
    // `config_json.avatars` snapshot get the same ids so the drilldown route
    // can resolve config_json → DB rows by id.
    const avatarsWithIds: AvatarProfile[] = body.avatars.map((a) => ({
      id: uuid(),
      role_in_sim: a.role_in_sim,
      name: a.name,
      role_label: a.role_label,
      personality: a.personality,
      values: a.values,
      baseline_output: a.baseline_output,
    }));

    const config: RunConfig = {
      avatars: avatarsWithIds,
      model: body.model ?? DEFAULT_MODEL,
      temperature: body.temperature ?? DEFAULT_TEMPERATURE,
      top_p: DEFAULT_TOP_P,
      prompt_template_version: PROMPT_TEMPLATE_VERSION,
      situation_tag_seed: Math.floor(Math.random() * 2 ** 31),
      sim_engine_version: SIM_ENGINE_VERSION,
    };

    await db.runs.insert({
      id: runId,
      createdAt: Date.now(),
      status: 'pending',
      roundsTotal: body.rounds_total,
      roundsCompleted: 0,
      targetPaper: body.target_paper,
      paperTotal: 0,
      experimentId: null,
      configJson: JSON.stringify(config),
      errorMessage: null,
      failedAtRound: null,
    });
    await db.avatars.insertMany(
      avatarsWithIds.map((a) => ({
        id: a.id,
        runId,
        roleInSim: a.role_in_sim,
        name: a.name,
        roleLabel: a.role_label,
        personality: a.personality,
        values: a.values,
        baselineOutput: a.baseline_output,
      })),
    );

    reply.code(201);
    setImmediate(() =>
      runner
        .run(runId)
        .catch((err) => app.log.error({ err, runId }, 'runner failure')),
    );
    return { id: runId };
  });

  // ── GET /runs ─────────────────────────────────────────────────────────────
  // Newest-first; trivial cursor pagination on created_at.
  app.get('/runs', async (req) => {
    const { limit, cursor } = ListRunsQuerySchema.parse(req.query);
    const rows = await db.runs.list({ limit, cursor: cursor ?? null });
    const items = rows.map(toRunListItem);
    const next_cursor =
      rows.length === limit ? rows[rows.length - 1]!.createdAt : null;
    return { runs: items, next_cursor };
  });

  // ── GET /runs/:id ─────────────────────────────────────────────────────────
  // Polled by the dashboard view every 2s while the run is non-terminal.
  // Excludes interaction text and self_perception entirely; the avatar
  // drilldown route owns those.
  app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const runRow = await db.runs.byId(req.params.id);
    if (!runRow) {
      reply.code(404);
      return { error: 'run not found' };
    }
    const avatars = await db.avatars.byRunId(runRow.id);
    const rounds = await db.rounds.byRunId(runRow.id);
    const roundAvatars = await db.roundAvatars.byRunId(runRow.id);
    return toRunDetail({
      run: runRow,
      avatars,
      rounds,
      roundAvatars,
      helpers: { teamExpected, workerExpectedShare, signedDelta },
    });
  });

  // ── GET /runs/:id/interactions ────────────────────────────────────────────
  // Full interaction timeline for the run, ordered by (round_index,
  // order_in_round). Strips self_perception from both sides (privacy rule).
  // Kept off the dashboard polling response to keep that payload small.
  app.get<{ Params: { id: string } }>(
    '/runs/:id/interactions',
    async (req, reply) => {
      const runRow = await db.runs.byId(req.params.id);
      if (!runRow) {
        reply.code(404);
        return { error: 'run not found' };
      }
      const [interactions, allAvatars] = await Promise.all([
        db.interactions.byRunId(runRow.id),
        db.avatars.byRunId(runRow.id),
      ]);
      const avatarsById = new Map(allAvatars.map((a) => [a.id, a]));
      return toRunInteractionsFeed({ interactions, avatarsById });
    },
  );

  // ── Reserved endpoints (slot exists; not implemented in v1) ──────────────
  // POST /runs/:id/cancel
  // POST /runs/:id/resume
  // POST /runs/:id/events
  // Documented in api.md so they're not designed away.
};
