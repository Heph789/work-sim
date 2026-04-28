// Fastify bootstrap. Wires together the DB, the LLM client, the Runner, and
// the HTTP routes. Single entrypoint — `pnpm dev` runs this under tsx watch.
//
// Process model (per locked-decisions.md): single Node process, single SQLite
// file, in-process runner. No queue, no workers. Correct for a single-user
// local prototype.

// DEPENDENCY: fastify
import Fastify, { type FastifyInstance } from "fastify";
// DEPENDENCY: @fastify/cors
import cors from "@fastify/cors";

import { createAppDb } from "./db/index.js";
import { createLLMClient } from "./llm/index.js";
import { Runner } from "./engine/runner.js";
import { runsRoutes } from "./routes/runs.js";

/**
 * Build, configure, and start the Fastify app. Exported so tests (when they
 * exist) can construct an instance without binding to a port.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: "http://localhost:3000" });

  const db = createAppDb(process.env.DATABASE_URL);
  const llm = createLLMClient();
  const runner = new Runner(llm, db);

  await app.register(runsRoutes, { db, runner });

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on :${port}`);
}

// Top-level await would also work; keeping main() explicit so tests can
// import buildApp without triggering listen. The import-meta check prevents
// main() from running when this module is imported (e.g. from a test).
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
