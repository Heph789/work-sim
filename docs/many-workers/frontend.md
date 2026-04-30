# Frontend — Many Workers

Next.js (App Router) + React + Tailwind, same stack as the prototype. Three
new things this iteration:

1. **Setup screen** supports adding/removing N worker panels.
2. **Dashboard view** replaces the old run-detail screen as the primary
   per-run landing page.
3. **Avatar drilldown view** is a new route; clicking an avatar from the
   dashboard drills into their interaction feed. A `?partner=` query string
   filters to a single pair.

For why these views, see `design.md` §14.

---

## Routes

| Route | File | Screen |
|---|---|---|
| `/` | `app/page.tsx` | Runs list |
| `/new` | `app/new/page.tsx` | Setup (1 manager + N workers) |
| `/runs/:id` | `app/runs/[id]/page.tsx` | Dashboard (per-run) |
| `/runs/:id/avatars/:avatarId` | `app/runs/[id]/avatars/[avatarId]/page.tsx` | Avatar drilldown (with `?partner=` for pair filter) |

All client components.

---

## Screen 1 — Runs list (`/`)

Mostly unchanged from the prototype, with worker_names rendered as a
compact list.

| Column | Source |
|---|---|
| Created | `created_at` (relative time) |
| Manager | `manager_name` |
| Workers | `worker_names.join(', ')`, truncated with "+N more" past 3 |
| Rounds | `rounds_completed / rounds_total` |
| Target | `paper_total / target_paper` |
| Hit? | ✓ / ✗ / — |
| Status | colored pill |

Auto-refresh every 5s if any row is non-terminal. Row click → `/runs/:id`.

---

## Screen 2 — Setup (`/new`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Manager                                                              │
│   Load preset: [ Michael Scott        ▼ ]                            │
│   Name        [ Michael Scott                              ]         │
│   Role label  [ Regional Manager                           ]         │
│   Personality [ ...                                        ]         │
│   Values      [ ...                                        ]         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ Workers                                            [ + Add worker ]  │
│                                                                      │
│   ┌──────────────────────────────────────┐  [ × ]                    │
│   │  Load preset: [ Jim Halpert     ▼ ]  │                           │
│   │  Name         [ Jim Halpert        ] │                           │
│   │  ...                                 │                           │
│   │  Baseline output [ 14 ]              │                           │
│   └──────────────────────────────────────┘                           │
│                                                                      │
│   ┌──────────────────────────────────────┐  [ × ]                    │
│   │  Load preset: [ Pam Beesly      ▼ ]  │                           │
│   │  ...                                 │                           │
│   └──────────────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ Simulation parameters                                                │
│   Sales target  [ 1500 ] units                                       │
│   Rounds        [ 10   ]                                             │
│   Model         [ gpt-4o-mini             ▼ ]                        │
│   Temperature   [ 0.8  ]                                             │
└──────────────────────────────────────────────────────────────────────┘

                                                          [   Run   ]
```

### Behavior

- One manager panel (always present).
- Worker panels: start with two pre-loaded (Jim, Pam by default), with
  **+ Add worker** appending blank panels and **×** removing them. Minimum
  one worker; the remove button is disabled when only one remains.
- Each panel has a preset dropdown that overwrites the panel's fields. The
  dropdown shows "(custom)" once any field diverges.
- Preset list comes from `packages/shared/src/presets.ts`. The manager
  dropdown filters to manager presets; worker dropdowns filter to worker
  presets.
- `Sales target` default scales with worker count: pre-fill
  `sum(worker baseline_output) × rounds_total / 2` (i.e. half the
  morale-50 expected total) so the team can plausibly hit it.
- Submit POSTs the avatars array (manager first, then workers in order).
- localStorage drafts keyed by `'work-sim:setup-draft-v2'` (bumped from v1
  because the shape changed).

### Validation (mirrors API Zod schema)

- ≥1 worker, exactly 1 manager.
- All names unique within the form.
- Baseline output integer ≥1 for workers.
- Required-field hints inline; submit disabled until valid.

---

## Screen 3 — Dashboard (`/runs/:id`)

Primary per-run landing. Live-polled.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◀ Back to runs                                                       │
│                                                                      │
│ Michael Scott + 3 workers   •   Round 7/10                           │
│ Target 1500   Sold 980   Expected 1050   42 below   Pending 3 rnds   │
│ ████████████████░░░░░░░░░░░░░░  65%                                  │
│                                                                      │
│ ┌──────────────┬─────────┬──────────┬───────┬───────────────────┐    │
│ │ Avatar       │ Role    │ Output   │ Morale│ Morale curve      │    │
│ ├──────────────┼─────────┼──────────┼───────┼───────────────────┤    │
│ │ Michael S.   │ manager │   —      │   —   │   —               │    │
│ │ Jim Halpert  │ worker  │ 92  (-3) │  62   │ ▁▃▅▆▆▅▆           │    │
│ │ Pam Beesly   │ worker  │ 105 (+10)│  78   │ ▂▄▅▇▇▇▇           │    │
│ │ Dwight S.    │ worker  │ 78  (-17)│  41   │ ▆▅▄▃▂▃▂           │    │
│ └──────────────┴─────────┴──────────┴───────┴───────────────────┘    │
│                                                                      │
│ ⠋ generating round 8…                                                │
└──────────────────────────────────────────────────────────────────────┘
```

### Header tiles

- Run summary string: "{manager_name} + {N} workers • Round {rounds_completed}/{rounds_total}".
- Numbers: `target_paper`, `paper_total`, `team_expected`, signed delta
  ("42 below" / "13 above"), rounds remaining.
- Progress bar = `paper_total / target_paper`.
- Status pill (pending/running/completed/failed).

### Avatar table

One row per avatar (manager first, then workers).

| Column | Source |
|---|---|
| Avatar | `name` (link to `/runs/:id/avatars/:avatarId`) |
| Role | `role_in_sim` |
| Output | `paper_total`, with signed delta vs. `worker_expected_share` in parentheses. `—` for manager. |
| Morale | `last_morale`. `—` for manager. |
| Morale curve | sparkline of `morale_curve`. `—` for manager. |

Sparklines use a tiny inline SVG (no chart library needed for ~10 points).

Row click → avatar drilldown.

### Footer

- "generating round N…" placeholder while `status === 'running'` and
  `rounds_completed < rounds_total`.
- Completion banner: ✓ "Hit target: 1530 / 1500" or ✗ "Missed target: 1310 /
  1500".
- Failed banner: red, "Run failed at round N." + `error_message`.

### Polling

`useRunPolling(id)` hook (same shape as prototype's), targeting `GET /runs/:id`.
Polls every 2000ms while non-terminal; stops on terminal status.

---

## Screen 4 — Avatar drilldown (`/runs/:id/avatars/:avatarId`)

Live-polled. Shows a single avatar's interaction feed and per-round state.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◀ Back to dashboard                                                  │
│                                                                      │
│ Jim Halpert  •  Sales Representative  •  worker                      │
│ Output 92   Morale 62   Self-perception:                             │
│   "Pam laughed at the prank but Michael was strange today…"          │
│                                                                      │
│ Filter:  [ All partners ▼ ]   (Pam Beesly, Dwight S., Michael S.)    │
│                                                                      │
│ ── Round 7 — quiet_week ──                                           │
│                                                                      │
│   1:1 with Michael S.                                                │
│   Michael:  "Hey Jim, how's it going buddy?"                         │
│   Jim:      "Yep, all good Michael."                                 │
│   morale 64 — "Standard meaningless check-in"                        │
│                                                                      │
│   chat with Pam Beesly                                               │
│   Jim:      "Want to mess with Dwight's stapler again?"              │
│   Pam:      "Always."                                                │
│   morale 71 — "Pam is the best part of this place"                   │
│                                                                      │
│   chat with Dwight S.                                                │
│   Dwight:   "Halpert, where is my stapler."                          │
│   Jim:      "Top shelf of the kitchen, third cabinet."               │
│   morale 69 — "He really fell for it again"                          │
│                                                                      │
│ ── Round 6 — missed_target ──                                        │
│ ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Header

- Name, role label, role_in_sim.
- Cumulative output (workers only).
- Last-round morale.
- Last-round self_perception (the avatar's own — fine to show, this is the
  drilldown for *this* avatar).

### Filter

- "Filter" dropdown lists every other avatar in the run as a partner.
- Selecting one navigates to `?partner=<otherId>`. Selecting "All partners"
  clears the query string.
- When a partner is selected, the header gains a small "Filtered: ↔
  Pam Beesly" pill with a clear-button.

### Interaction list

- Grouped by round, newest at top (or oldest? — recommended: oldest at top
  to read top-to-bottom like a transcript; round number labels make scrolling
  feasible either way. Auto-scroll behavior should mirror the prototype:
  scroll to bottom on new round arrival unless the user has scrolled up).
- Within a round, ordered by `order_in_round` ascending.
- Each interaction renders as:
  - Header line: "1:1 with Michael S." (when partner is the manager) or
    "chat with Pam Beesly" (when peer). Determined client-side from
    participants' `role_in_sim`.
  - Two dialogue lines, with the *avatar in this view* highlighted
    (the one whose drilldown this is — bolded name).
  - Footer: "morale {responder_morale} — {responder_morale_rationale}" when
    the avatar is the responder; "morale {initiator_morale} —
    {initiator_morale_rationale}" when initiator. (For manager 1:1s where
    the avatar is the worker, only responder_morale is populated.)

### Polling

Polls `GET /runs/:id/avatars/:avatarId?partner=<id>` every 2000ms while the
underlying run is non-terminal. Hook: `useAvatarPolling(runId, avatarId,
partnerId)`.

---

## Component layout

```
apps/web/
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── page.tsx                                    # /
│   ├── new/page.tsx                                # /new
│   ├── runs/[id]/page.tsx                          # /runs/:id (dashboard)
│   └── runs/[id]/avatars/[avatarId]/page.tsx       # /runs/:id/avatars/:avatarId (drilldown)
├── components/
│   ├── avatar-form.tsx                             # one panel; manager or worker mode
│   ├── worker-panels.tsx                           # add/remove list of avatar-forms
│   ├── preset-dropdown.tsx                         # filtered by role
│   ├── dashboard-table.tsx                         # avatar rows
│   ├── sparkline.tsx                               # inline SVG morale curve
│   ├── interaction-block.tsx                       # one interaction in the drilldown
│   ├── round-header.tsx                            # "── Round N — situation_tag ──"
│   ├── partner-filter.tsx                          # dropdown that flips ?partner=
│   ├── status-pill.tsx
│   └── progress-bar.tsx
├── hooks/
│   ├── use-runs.ts                                 # /
│   ├── use-run-polling.ts                          # dashboard
│   └── use-avatar-polling.ts                       # drilldown
├── lib/
│   └── api.ts                                      # fetch wrappers
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

---

## Tailwind / styling

Same minimal Tailwind approach as the prototype. Same `.btn-primary`,
`.btn-secondary`, `.input`, `.label` utilities. Sparklines are plain inline
SVG; `<polyline>` over a 0–100 viewbox.

---

## What the frontend does NOT do this iteration

- No live-streamed (per-token) LLM output.
- No mid-run controls (pause/cancel/inject).
- No experiments view.
- No comparison between runs (overlaid morale curves across runs).
- No reputation matrix view.
- No saved user-authored avatar profiles.
- No keyboard shortcuts.
- No dark mode.
- No login.
- No download / export of interaction transcripts.
