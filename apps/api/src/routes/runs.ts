// HTTP routes for the runs resource. Thin: validate input, snapshot config,
// kick off the runner, expose read endpoints. No business logic beyond shape.
// All endpoints return JSON; no auth in v1.
//
// See docs/initial-prototype/api.md for the wire shapes.

import type { FastifyPluginAsync } from 'fastify';
import { v4 as uuid } from 'uuid';

import type { RunConfig } from '@work-sim/shared';

import type { AppDb } from '../db/index.js';
import type { Runner } from '../engine/runner.js';
import { SIM_ENGINE_VERSION } from '../engine/runner.js';
import { PROMPT_TEMPLATE_VERSION } from '../engine/prompts.js';
import {
  CreateRunRequestSchema,
  ListRunsQuerySchema,
  toRunListItem,
  toRunDetail,
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
const DEFAULT_MODEL = 'gpt-4.1';
/** Fastify default for `temperature` if omitted. */
const DEFAULT_TEMPERATURE = 0.8;
/** Default top_p — captured into config_json even though it's not in the request body. */
const DEFAULT_TOP_P = 1.0;

/**
 * Plugin that registers all /runs endpoints. Mounted with `prefix: ''` so
 * routes live at the API root.
 */
export const runsRoutes: FastifyPluginAsync<RunsRouteDeps> = async (app, opts) => {
  const { db, runner } = opts;

  // ── POST /runs ────────────────────────────────────────────────────────────
  // Creates the run, snapshots config, fires off the runner, returns 201 { id }.
  app.post('/runs', async (req, reply) => {
    const parsed = CreateRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request', details: parsed.error.flatten() };
    }
    const body = parsed.data;
    const id = uuid();
    const config: RunConfig = {
      agents: body.agents,
      model: body.model ?? DEFAULT_MODEL,
      temperature: body.temperature ?? DEFAULT_TEMPERATURE,
      top_p: DEFAULT_TOP_P,
      prompt_template_version: PROMPT_TEMPLATE_VERSION,
      situation_tag_seed: Math.floor(Math.random() * 2 ** 31),
      sim_engine_version: SIM_ENGINE_VERSION,
    };
    await db.runs.insert({
      id,
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
    reply.code(201);
    setImmediate(() =>
      runner.run(id).catch((err) => app.log.error({ err, runId: id }, 'runner failure')),
    );
    return { id };
  });

  // ── GET /runs ─────────────────────────────────────────────────────────────
  // Lists runs newest first. Trivial cursor pagination on created_at.
  app.get('/runs', async (req) => {
    const { limit, cursor } = ListRunsQuerySchema.parse(req.query);
    const rows = await db.runs.list({ limit, cursor: cursor ?? null });
    const items = rows.map(toRunListItem);
    const next_cursor =
      rows.length === limit ? rows[rows.length - 1]!.createdAt : null;
    return { runs: items, next_cursor };
  });

  // ── GET /runs/:id ─────────────────────────────────────────────────────────
  // Polled by the run-detail screen every 2s while the run is non-terminal.
  app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const run = await db.runs.byId(req.params.id);
    if (!run) {
      reply.code(404);
      return { error: 'run not found' };
    }
    const rounds = await db.rounds.byRunId(run.id);
    return toRunDetail({ run, rounds });
  });

  // ── Reserved endpoints (slot exists; not implemented in v1) ──────────────
  // POST /runs/:id/cancel
  // POST /runs/:id/resume
  // POST /runs/:id/events
  // Documented in api.md so they're not designed away.
};
