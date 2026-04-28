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
