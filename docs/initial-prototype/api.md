# API

Fastify HTTP layer. Thin: validates input, snapshots config, kicks off the
runner, exposes read endpoints for the frontend's polling loop. No business
logic beyond shape validation.

For why polling, see `locked-decisions.md` #5.

---

## Endpoints

| Method | Path | Purpose | Status |
|---|---|---|---|
| `POST` | `/runs` | Create + start a new run | v1 |
| `GET` | `/runs` | List runs (newest first) | v1 |
| `GET` | `/runs/:id` | Run detail incl. all completed rounds (polled) | v1 |
| `GET` | `/healthz` | Liveness check | v1 |
| `POST` | `/runs/:id/cancel` | Cooperative cancel | reserved, deferred |
| `POST` | `/runs/:id/resume` | Resume from `failed`/`paused` | reserved, deferred |
| `POST` | `/runs/:id/events` | Inject mid-run events | reserved, deferred |

All requests/responses are JSON. No auth in v1.

---

## `POST /runs`

Creates a new run, snapshots inputs, kicks off the runner asynchronously,
returns immediately with the run id.

### Request

```ts
{
  agents: [
    {
      role_in_sim: 'manager' | 'worker',
      name: string,                    // 1-80 chars
      role_label: string,              // 1-80 chars, e.g. "Regional Manager"
      personality: string,             // 1-2000 chars, free-form
      values: string,                  // 1-2000 chars, free-form
      baseline_output: number,         // integer, 1-100
    },
    // exactly 2 agents in v1: one manager, one worker
  ],
  target_paper: number,                // integer, ≥ 1
  rounds_total: number,                // integer, 1-100 (sanity cap)
  model?: string,                      // default: 'gpt-4.1'
  temperature?: number,                // 0-2, default 0.8
}
```

Validation: Zod schema in `apps/api/src/routes/schemas.ts`. Reject anything
outside these bounds with 400.

### Response (201 Created)

```ts
{ id: string }   // uuid; client navigates to /runs/:id and starts polling
```

### Side effects

- Inserts a `runs` row with:
  - `status = 'pending'` (becomes `running` once the runner starts)
  - `config_json` populated with the snapshot (see `data-model.md`)
  - `experiment_id = null` (sandbox)
- `setImmediate(() => runner.run(id))` to start the runner without blocking
  the HTTP response.

### Errors

- `400` invalid input
- `500` DB write failed (rare)

---

## `GET /runs`

Lists runs, newest first. Used by the runs list screen.

### Query params

- `limit` (default 50, max 200)
- `cursor` (optional `created_at` ms for pagination — trivial cursor scheme)

### Response (200)

```ts
{
  runs: [
    {
      id: string,
      created_at: number,
      status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
      rounds_total: number,
      rounds_completed: number,
      target_paper: number,
      paper_total: number,
      hit_target: boolean | null,        // null while not completed
      manager_name: string,              // pulled from config_json for display
      worker_name: string,               // pulled from config_json for display
    },
    ...
  ],
  next_cursor: number | null
}
```

The `manager_name` / `worker_name` denormalization is for the list view —
avoids the frontend needing to parse `config_json` just to render a row.

---

## `GET /runs/:id`

Full run detail. Polled by the run-detail screen every 2s while `status` is
non-terminal.

### Response (200)

```ts
{
  id: string,
  created_at: number,
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
  rounds_total: number,
  rounds_completed: number,
  target_paper: number,
  paper_total: number,
  experiment_id: string | null,
  config: {
    agents: [
      {
        role_in_sim: 'manager' | 'worker',
        name: string,
        role_label: string,
        personality: string,
        values: string,
        baseline_output: number,
      },
      ...
    ],
    model: string,
    temperature: number,
    prompt_template_version: string,
    sim_engine_version: string,
    // situation_tag_seed deliberately omitted from the API response
    // (internal detail; can be exposed later if useful)
  },
  rounds: [
    {
      round_index: number,
      situation_tag: string,
      manager_message: string,
      worker_message: string,
      worker_self_perception: string,
      morale: number,
      paper_sold: number,
      created_at: number,
    },
    ...
  ],  // ordered by round_index ascending
  error_message: string | null,
  failed_at_round: number | null,
}
```

### Errors

- `404` run not found

### Polling expectations

- Frontend polls every 2000ms when `status` is `pending` or `running`.
- Stops polling when `status` is `completed`, `failed`, or `cancelled`.
- Server returns the same shape every time; the frontend diffs by
  `rounds.length` to know if anything new arrived.
- No ETag or conditional GET in v1 — the payloads are small (a 50-round run
  is ~50 KB of JSON).

---

## `GET /healthz`

```
200 OK
{ ok: true }
```

For the dev tooling. Doesn't touch the DB.

---

## Reserved endpoints (schema slot exists; not implemented in v1)

These are documented so we don't accidentally design them away:

### `POST /runs/:id/cancel`

Sets `runs.status = 'cancelled'`. Runner sees it on next checkpoint and
exits. No body. 200 with the updated run shape.

### `POST /runs/:id/resume`

Only valid from `failed` (and later `paused`/`cancelled`). Re-spawns the runner;
it picks up at `rounds_completed + 1` using the original `config_json`.

### `POST /runs/:id/events`

Body: `{ type: string, payload: any }`. Appends to a (future) `events` table.
The next round's prompt builder reads any unconsumed events for the run and
weaves them into the situation context.

---

## Bootstrap

```ts
// apps/api/src/index.ts
import Fastify from 'fastify';
import { db } from './db';
import { createLLMClient } from './llm';
import { Runner } from './engine/runner';
import { runsRoutes } from './routes/runs';

const app = Fastify({ logger: true });
const llm = createLLMClient();
const runner = new Runner(llm, db);

app.decorate('runner', runner);
app.decorate('db', db);

app.register(runsRoutes, { prefix: '' });

app.get('/healthz', async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`API listening on :${port}`);
});
```

CORS: enable for `http://localhost:5173` (Vite default) in dev:

```ts
import cors from '@fastify/cors';
app.register(cors, { origin: 'http://localhost:5173' });
```

---

## What the API does NOT do in v1

- No auth, no users, no tenancy.
- No SSE / websockets.
- No rate limiting (single-user local).
- No request idempotency keys (`POST /runs` racing twice creates two runs;
  fine for a single user clicking once).
- No DELETE on runs (append-only; clean DB by deleting the SQLite file).
- No PATCH on runs (immutable after creation).
- No file uploads, exports, or import endpoints.
