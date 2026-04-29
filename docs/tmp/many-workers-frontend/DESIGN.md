# Many-workers — Frontend scaffold

Frontend-only design for `docs/many-workers/design.md`. The backend / engine /
schema is out of scope for this scaffold; this doc only tracks how the web
app surfaces the new data model.

## 1. Overview

The prior prototype had a single-screen run view: manager + worker, transcript
of N rounds, two charts. The new model multiplies the participant axis (N≥1
workers + 1 manager) and adds a *kind* axis (manager-1:1 vs peer). A single
transcript no longer scales — a run with N=4 workers and T=10 rounds has up
to 4·(N + N) = 8N·T = 80 interactions, with overlapping participants.

The redesign therefore splits the run page into two views:

- **Dashboard** (primary, on `/runs/:id`) — per-run summary: header stats +
  one row per avatar (current morale, cumulative paper, last-round paper,
  morale sparkline). Live-polled.
- **Avatar drilldown** (`/runs/:id/avatars/:avatarId`) — that one avatar's
  interactions in `(round_index, order_in_round)` order, plus a per-round
  morale chart. Filterable by round and by partner via query string.

The runs list (`/`) gains a workers-count column; clicking a row routes to
the dashboard.

## 2. Key design decisions

### 2.1 Terminology — "avatar" everywhere

Locked by `docs/many-workers/design.md` §Terminology and the user's standing
naming preference. Code, props, types, route segments (`/avatars/:avatarId`),
local-storage keys, comments. The prior `agent-form.tsx` etc. files are
renamed `avatar-form.tsx`. `AgentRole` → `AvatarRole`. `AgentProfile` →
`AvatarProfile`.

### 2.2 No `RoundView` with manager_message/worker_message anymore

Old wire shape collapsed an entire round into one "row" with a singular
manager line and worker line. With N workers and a peer phase, a round has
N + K interactions. The wire shape now exposes:

- `RoundView` — slim: `{ round_index, situation_tag, created_at }`.
- `RoundAvatarView` — per-(round, avatar) end-of-round state: morale,
  morale_rationale, self_perception, paper_sold.
- `InteractionView` — the full interaction row, including initiator/responder
  ids, both messages, and morale fields (initiator-side may be null when the
  manager is the initiator).

`RunDetail` becomes a fan-out: `{ ..., avatars[], rounds[], round_avatars[],
interactions[] }`. The frontend reshapes this into per-avatar timelines on
the client; the API stays a single GET.

### 2.3 One avatar drilldown route, not per-pair routes

§14.3 of the design doc: pair filter is a query string on the avatar view, not
a separate route. Implementation: `/runs/:id/avatars/:avatarId?partner=:other`
filters the interaction list to a specific pair. This keeps URL count low
and matches the user's stated preference.

### 2.4 Dashboard sparklines, drilldown full-chart

The dashboard needs morale-over-rounds *per avatar*, but a full Recharts
chart per row is heavy. Use a custom inline SVG sparkline (≤80px wide) for
the table; reserve `recharts` for the drilldown morale chart and any future
full-size views.

### 2.5 Manager information asymmetry is a backend concern

The frontend trusts whatever the API returns and renders it. The
information-asymmetry rule (manager prompt does not see worker morale /
self_perception / baseline) applies to the *prompt construction* path, not
the dashboard. The dashboard intentionally shows everyone's morale to the
human user — the human is omniscient by design.

(Recorded as a project memory: the frontend dashboard is allowed to display
worker morale; the asymmetry constraint only applies to LLM prompt
inputs.)

### 2.6 Setup form: N-worker editor

The new run page now has one manager panel and a workers list (add / remove,
N≥1). Worker presets stay reusable across rows. `localStorage` schema bumps:
`work-sim:setup-draft` becomes `{ manager, workers[], target_paper,
rounds_total, model, temperature }`. Old drafts under the previous shape are
discarded silently (greenfield).

### 2.7 Runs list shows worker count, not worker name

The list page can no longer render a single worker name. Instead show
`{manager_name} · {n_workers} workers`. The list endpoint must denormalize
`n_workers` onto each row.

## 3. Data flow

```
GET /runs        ─►  RunListItem[]           ─►  app/page.tsx        (table)
GET /runs/:id    ─►  RunDetail               ─►  app/runs/[id]/page.tsx (dashboard)
                                              └►  app/runs/[id]/avatars/[avatarId]/page.tsx (drilldown)
POST /runs       ◄─  CreateRunRequest        ◄─  app/new/page.tsx    (setup)
```

Polling cadence is unchanged: list = 5s, detail = 2s, both stop on terminal
status. The drilldown page reuses `useRunPolling(runId)` and slices the
returned `RunDetail` to the avatar's interactions client-side.

## 4. Component tree

```
app/page.tsx                                  [runs list]
  StatusPill

app/new/page.tsx                              [setup]
  AvatarForm × 1 (manager)
  WorkersListEditor
    AvatarForm × N (workers)
      PresetDropdown
  (params section: target / rounds / model / temperature)

app/runs/[id]/page.tsx                        [dashboard]
  DashboardHeader
    ProgressBar
    StatusPill
  AvatarTable
    AvatarTableRow × (1 + N)
      MoraleSparkline

app/runs/[id]/avatars/[avatarId]/page.tsx     [avatar drilldown]
  StatusPill
  AvatarMoraleChart
  AvatarInteractionsList
    InteractionBlock × M (filtered)
```

Hooks: `useRuns`, `useRunPolling` (both unchanged externally; only their
return types change).

## 5. Open questions

1. **Average vs total morale chart.** Dashboard shows per-avatar sparklines.
   Should there also be a *team* morale chart (avg across workers) on the
   header? Deferred — design doc doesn't ask for it.
2. **Manager row in the dashboard table.** Manager has no morale and no
   paper_sold. Render a row with em-dashes, or skip the manager entirely?
   Scaffolded as an em-dash row to keep the avatar list canonical; worth a
   product call later.
3. **Interaction ordering in the drilldown.** For an avatar A, interactions
   come from initiator-side (A → B) and responder-side (B → A). Both should
   be merged and sorted by `(round_index, order_in_round)`. The UI labels
   each block "you initiated" vs "you responded" so the direction is legible.
4. **Sparkline interaction.** Click-through from sparkline to drilldown? Yes
   — the whole row is a link to the avatar drilldown. The sparkline itself
   is decorative.

## 6. Out of scope for this scaffold

- Backend / API / engine.
- Tests.
- New CSS utilities (existing Tailwind classes only).
- Storybook or component-level docs.
- Reputation matrix UI, manager-attention scarcity (deferred per §15 of the
  design doc).
