# API — Many Workers

Fastify HTTP layer. Same role as the prototype: thin validation + snapshot +
fire-and-forget runner + read endpoints for the frontend's polling. The
endpoints evolve to support 1-manager-N-workers and to serve the dashboard
and avatar-drilldown views.

For why polling and the persistence model, see prototype `locked-decisions.md`
#5; for the multi-worker shape, see `design.md`.

---

## Endpoints

| Method | Path | Purpose | Status |
|---|---|---|---|
| `POST` | `/runs` | Create + start a new run | v2 |
| `GET` | `/runs` | List runs (newest first) | v2 |
| `GET` | `/runs/:id` | Run dashboard read (polled) | v2 |
| `GET` | `/runs/:id/avatars/:avatarId` | Avatar drilldown read (polled) | v2 |
| `GET` | `/healthz` | Liveness | v1 |
| `POST` | `/runs/:id/cancel` | Cooperative cancel | reserved |
| `POST` | `/runs/:id/resume` | Resume from `failed`/`paused` | reserved |
| `POST` | `/runs/:id/events` | Inject mid-run events | reserved |

All requests/responses JSON. No auth.

---

## `POST /runs`

Creates a new run. Validates the avatars shape (exactly one manager, ≥1
workers), inserts `run` + `avatar` rows, snapshots `config_json`,
fire-and-forgets the runner.

### Request

```ts
{
  avatars: [
    {
      role_in_sim: 'manager' | 'worker',
      name: string,                    // 1–80 chars
      role_label: string,              // 1–80 chars
      personality: string,             // 1–2000 chars
      values: string,                  // 1–2000 chars
      baseline_output: number,         // workers: integer 1–100; managers: 0 or 1 (ignored)
    },
    // ...
    // exactly 1 manager and 1+ workers
  ],
  target_paper: number,                // integer ≥ 1
  rounds_total: number,                // integer 1–50 (sanity cap)
  model?: string,                      // default 'gpt-4o-mini'
  temperature?: number,                // 0–2, default 0.8
}
```

### Validation rules

- `avatars.length ≥ 2` — at least one manager, at least one worker.
- Exactly one element has `role_in_sim = 'manager'`.
- All other elements have `role_in_sim = 'worker'`.
- `name` is unique within the avatars array (avoids ambiguous transcript lines).
- Worker `baseline_output` ≥ 1.

Implemented as Zod schema in `apps/api/src/routes/schemas.ts`. 400 with the
violation summary on failure.

### Response (201)

```ts
{ id: string }   // run uuid
```

### Side effects

- Insert `run` row, `status='pending'`, `experiment_id=null`.
- Insert one `avatar` row per element of `avatars` (each gets a fresh uuid).
- Build `config_json` containing the avatar profiles **with their newly
  assigned ids**, plus model/temperature/prompt_template_version /
  situation_tag_seed / sim_engine_version.
- `setImmediate(() => runner.run(id))`.

---

## `GET /runs`

Runs list. Same shape as prototype but with team-aware names.

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
      hit_target: boolean | null,            // null while not completed
      manager_name: string,                  // pulled from avatar row
      worker_names: string[],                // all worker names, ordered as in config_json
    },
    ...
  ],
  next_cursor: number | null
}
```

`worker_names` is denormalized so the runs list can render "Michael Scott +
Jim, Pam, Dwight" without joining `avatar` per row.

---

## `GET /runs/:id` — dashboard read

Polled by the dashboard view every 2s while `status` is non-terminal.

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
  team_expected: number,                    // round(target_paper * rounds_completed / rounds_total)
  team_delta: { abs: number, direction: 'above' | 'below' },
  experiment_id: string | null,
  config: {
    avatars: [
      {
        id: string,
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
  },
  rounds: [
    {
      round_index: number,
      situation_tag: string,
      created_at: number,
      avatars: [
        {
          avatar_id: string,
          morale: number | null,
          paper_sold: number | null,
        },
        ...
      ],
    },
    ...
  ],                                        // ordered by round_index ascending
  // Per-avatar aggregates for the dashboard tiles.
  per_avatar: [
    {
      avatar_id: string,
      name: string,
      role_in_sim: 'manager' | 'worker',
      role_label: string,
      paper_total: number | null,           // null for manager
      worker_expected_share: number | null, // null for manager
      worker_delta: { abs: number, direction: 'above' | 'below' } | null,
      last_morale: number | null,
      morale_curve: number[],               // one entry per completed round (null padded if absent)
      paper_per_round: number[],            // same length as morale_curve
    },
    ...
  ],
  error_message: string | null,
  failed_at_round: number | null,
}
```

The dashboard does not include any `interaction` rows or `self_perception`
text — those are private and/or large. Drilldown fetches them as needed.

### Errors

- `404` run not found.

### Polling

- Frontend polls every 2000ms while status is `pending` / `running`.
- Stops on terminal status.
- Server returns the same shape every time; frontend diffs by
  `rounds_completed`.

---

## `GET /runs/:id/avatars/:avatarId` — avatar drilldown read

Powers the avatar view. Returns the full per-avatar interaction feed plus
that avatar's morale/paper history. Optionally filtered to a single partner
via query string.

### Query params

- `partner` (optional, avatar id) — when present, restrict the interaction
  feed to interactions involving exactly the avatar↔partner pair (in either
  direction).

### Response (200)

```ts
{
  avatar: {
    id: string,
    role_in_sim: 'manager' | 'worker',
    name: string,
    role_label: string,
    personality: string,
    values: string,
    baseline_output: number,
  },
  partner: null | {                         // populated when `?partner=` is set
    id: string,
    name: string,
    role_in_sim: 'manager' | 'worker',
    role_label: string,
  },
  // The avatar's per-round state, full history (private — drilldown only).
  rounds: [
    {
      round_index: number,
      situation_tag: string,
      morale: number | null,
      morale_rationale: string | null,
      self_perception: string | null,
      paper_sold: number | null,
    },
    ...
  ],
  // Interactions where this avatar was initiator or responder, ordered by
  // (round_index, order_in_round). When `?partner=` is set, additionally
  // restrict to pair.
  interactions: [
    {
      id: string,
      round_index: number,
      order_in_round: number,
      situation_tag: string,
      initiator: { id: string, name: string, role_in_sim: 'manager' | 'worker' },
      responder: { id: string, name: string, role_in_sim: 'manager' | 'worker' },
      initiator_message: string,
      responder_message: string,
      initiator_morale: number | null,
      initiator_morale_rationale: string | null,
      responder_morale: number,
      responder_morale_rationale: string,
      // self_perception fields are NOT returned here — those are the avatar's
      // private inner monologue and are exposed only via `rounds[].self_perception`
      // (i.e. only on the rows where the avatar is the subject).
      created_at: number,
    },
    ...
  ],
}
```

Note on self_perception privacy: the response includes the *subject avatar's*
own self_perception (in `rounds[]`). Other participants' self_perceptions are
never exposed — even though they exist on `interaction` rows in the DB, the
API filters them out so the drilldown can never accidentally surface someone
else's inner state to the user.

### Errors

- `404` run / avatar not found, or `partner` id not in the run.

### Polling

- Same cadence as the dashboard read while the run is live.
- Frontend can poll the dashboard and the drilldown independently; both are
  cheap reads.

---

## Bootstrap

Same as the prototype. CORS opened for the Next.js dev origin. The route
files split as:

```
apps/api/src/routes/
├── runs.ts          # POST /runs, GET /runs, GET /runs/:id
└── avatars.ts       # GET /runs/:id/avatars/:avatarId
```

`schemas.ts` holds Zod schemas for the request bodies, including the
multi-worker validation shape.

---

## What the API does NOT do in v2

- No auth, no users, no tenancy.
- No SSE / websockets.
- No rate limiting.
- No request idempotency keys.
- No DELETE / PATCH on runs (immutable; clean by deleting the SQLite file).
- No endpoint to stream `interaction` rows live — drilldown re-fetches.
- No endpoints for direct `interaction` filtering across all runs (the data
  is queryable in the DB but no public endpoint).
- No endpoint exposing other avatars' `self_perception`.
