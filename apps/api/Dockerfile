# syntax=docker/dockerfile:1.7
# Build context is the repo root (see ../../railway.json -> dockerfilePath).
# We need both apps/api and packages/shared, since the api's `file:` dep on
# @work-sim/shared crosses package boundaries.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

# ─── Build stage ────────────────────────────────────────────────────────────
# Has the toolchain needed to compile better-sqlite3 from source if no
# prebuilt is available for node:20-alpine.
FROM base AS build
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /repo

COPY tsconfig.base.json /repo/tsconfig.base.json
COPY packages/shared /repo/packages/shared
COPY apps/api /repo/apps/api

# Shared has its own deps (zod) — the api's bundler resolves them from
# packages/shared/node_modules at build time.
WORKDIR /repo/packages/shared
RUN pnpm install --frozen-lockfile

WORKDIR /repo/apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ─── Runtime stage ──────────────────────────────────────────────────────────
# Slimmer image: no compilers, just the built bundle + node_modules.
FROM base AS runtime
WORKDIR /repo

COPY --from=build /repo/packages/shared /repo/packages/shared
COPY --from=build /repo/apps/api /repo/apps/api

WORKDIR /repo/apps/api
ENV NODE_ENV=production
EXPOSE 4000
CMD ["pnpm", "start"]
