# work-sim

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- An OpenAI API key

## Setup

```bash
# 1. Install dependencies (root + each package)
pnpm install
pnpm --dir packages/shared install
pnpm --dir apps/api install

# 2. Configure environment
cp .env.example apps/api/.env
# then edit apps/api/.env and set OPENAI_API_KEY

# 3. Initialize the SQLite schema
pnpm db:push
```

The schema push creates `apps/api/work-sim.db`. To reset state at any time, delete `*.db*` files in `apps/api/` and re-run `pnpm db:push`.

## Run

```bash
# Start the API in watch mode (defaults to http://localhost:4000)
pnpm dev
```

Sanity check:

```bash
curl http://localhost:4000/healthz
# → {"ok":true}
```

## Example: a 10-round Michael × Jim run

```bash
curl -X POST http://localhost:4000/runs \
  -H "Content-Type: application/json" \
  -d '{
    "agents": [
      {
        "role_in_sim": "manager",
        "name": "Michael Scott",
        "role_label": "Regional Manager",
        "personality": "Well-meaning and desperate to be liked. Treats the office as a family. Often inappropriate, easily distracted, prone to grand gestures and ill-conceived speeches. Tries hard to be funny. Avoids conflict by deflecting with humor or by leaving the room. Genuinely cares about his people but expresses it clumsily.",
        "values": "Being liked. Loyalty. Office camaraderie. Recognition from corporate. Hates being criticized or feeling unloved. Prefers harmony over hard truths.",
        "baseline_output": 1
      },
      {
        "role_in_sim": "worker",
        "name": "Jim Halpert",
        "role_label": "Sales Representative",
        "personality": "Sharp, sarcastic, and disengaged in ways that don'"'"'t show on the surface. Charming with clients and coworkers. Pulls pranks to amuse himself when work feels meaningless. Highly capable but underutilized — coasts when nothing is asked of him; rises to the occasion when stakes are real.",
        "values": "Autonomy. Humor. Not being micromanaged. Genuine connection with coworkers. Hates fake enthusiasm, mandatory fun, and being treated as a number.",
        "baseline_output": 14
      }
    ],
    "target_paper": 500,
    "rounds_total": 10,
    "model": "gpt-4o-mini",
    "temperature": 0.8
  }'
# → {"id":"<uuid>"}
```

The run executes asynchronously. Poll `GET /runs/<id>` every ~2s to watch rounds appear; status moves `pending → running → completed` (or `failed`). A 10-round run takes ~40s with `gpt-4o-mini`.

```bash
# Watch progress
RUN_ID="<uuid-from-above>"
curl -s http://localhost:4000/runs/$RUN_ID | python3 -m json.tool
```

## Quick: start a preset run from the CLI

```bash
# Interactive preset picker:
pnpm --dir apps/api start-run

# By preset key:
pnpm --dir apps/api start-run michael-scott jim-halpert

# With overrides:
pnpm --dir apps/api start-run jan-levinson dwight-schrute --rounds 5 --target 200

# List all presets:
pnpm --dir apps/api start-run --help
```

The script POSTs to `localhost:4000/runs` (override with `API_URL`) and polls until the run reaches a terminal state, printing each round (including the worker's morale rationale) as it lands.

## Debug: Log LLM prompts and responses

To see full prompts and responses to/from the LLM (stderr, JSON-formatted):

```bash
LOG_LLM=1 pnpm dev
```

Logs all LLM calls with request (messages, model, temperature, etc.) and response (completion or structured object). Useful for understanding how situation tags / morale / prompt context shape the model's behavior.

## Test

```bash
pnpm --dir apps/api test
```

## Build (type-check)

```bash
pnpm --dir apps/api build
```

## Environment variables

See `.env.example`. The API reads:

- `OPENAI_API_KEY` — required when `LLM_PROVIDER=openai` (the default)
- `LLM_PROVIDER` — `openai` (default); `anthropic` is reserved
- `PORT` — defaults to `4000`
- `DATABASE_URL` — SQLite path; defaults to `./work-sim.db`
