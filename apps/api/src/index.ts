// Fastify bootstrap. Wires together the DB, the LLM client, the Runner, and
// the HTTP routes. Single entrypoint — `pnpm dev` runs this under tsx watch.
//
// Process model (per locked-decisions.md): single Node process, single SQLite
// file, in-process runner. No queue, no workers. Correct for a single-user
// local prototype.

// DEPENDENCY: fastify
import Fastify from 'fastify';
// DEPENDENCY: @fastify/cors
import cors from '@fastify/cors';

import { createAppDb } from './db/index.js';
import { createLLMClient } from './llm/index.js';
import { Runner } from './engine/runner.js';
import { runsRoutes } from './routes/runs.js';

/**
 * Build, configure, and start the Fastify app. Exported so tests (when they
 * exist) can construct an instance without binding to a port.
 */
export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: true });

  // CORS for the Vite dev server origin. Tighten for any non-local deployment.
  // TODO: app.register(cors, { origin: 'http://localhost:5173' });

  // Wire singletons: one DB, one LLM client, one Runner shared across all runs.
  // TODO:
  //   const db = createAppDb(process.env.DATABASE_URL);
  //   const llm = createLLMClient();
  //   const runner = new Runner(llm, db);
  //   app.register(runsRoutes, { db, runner });

  /** Liveness check. Doesn't touch the DB. */
  app.get('/healthz', async () => ({ ok: true }));

  void cors;
  void createAppDb;
  void createLLMClient;
  void Runner;
  void runsRoutes;

  return app;
}

/**
 * Process entrypoint. Calls buildApp() then listens. Errors during boot are
 * logged and exit non-zero so process supervisors see the failure.
 */
async function main(): Promise<void> {
  // TODO:
  //   const app = await buildApp();
  //   const port = Number(process.env.PORT ?? 4000);
  //   await app.listen({ port, host: '0.0.0.0' });
  //   app.log.info(`API listening on :${port}`);
  throw new Error('main: not implemented');
}

// Top-level await would also work; keeping main() explicit so tests can
// import buildApp without triggering listen.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
