# Frontend

React + Vite + Tailwind. Three screens, two routes for navigation, polling-based
live updates. No global state library — local `useState` + a tiny
`useRunPolling` hook is enough.

For why this shape, see `locked-decisions.md` #5, #10, #11.

---

## Routes

| Route | Screen | Notes |
|---|---|---|
| `/` | Runs list | Table of past + in-progress runs, "New run" button. |
| `/new` | Setup | Two agent forms (preset dropdowns), target, rounds, model, run button. |
| `/runs/:id` | Run detail | Live (polling) or completed view. Transcript + morale chart + paper total. |

Use `react-router` v6+ — minimal config, three `<Route>` entries.

---

## Screen 1 — Runs list (`/`)

A simple table. One row per run, newest first.

### Columns

| Column | Source |
|---|---|
| Created | `created_at` formatted as relative time ("2 min ago") |
| Manager | `manager_name` |
| Worker | `worker_name` |
| Rounds | `rounds_completed / rounds_total` |
| Target | `paper_total / target_paper` |
| Hit? | ✓ if `paper_total ≥ target_paper`, ✗ otherwise, — if not completed |
| Status | colored pill: pending/running/completed/failed |

### Affordances

- **New run** button → `/new`.
- Row click → `/runs/:id`.
- Auto-refresh the list every 5s if any row is `pending` or `running`
  (cheap; one query). Stop polling once all rows are terminal.
- Empty state: "No runs yet — start your first sim."

### Component sketch

```tsx
function RunsList() {
  const { runs, loading } = useRuns();
  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <Link to="/new" className="btn-primary">New run</Link>
      </div>
      {loading ? <Spinner /> : runs.length === 0 ? <EmptyState /> : (
        <table className="w-full text-sm">
          <thead>...</thead>
          <tbody>
            {runs.map(r => <RunRow key={r.id} run={r} />)}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
```

---

## Screen 2 — Setup (`/new`)

Form for creating a run. Two side-by-side agent panels (manager left, worker
right), then a "simulation parameters" section below, then a Run button.

### Agent panel

For each of {manager, worker}:

```
┌─────────────────────────────────────────┐
│ Manager                                 │
│                                         │
│ Load preset: [ Michael Scott      ▼ ]   │
│                                         │
│ Name        [ Michael Scott           ] │
│ Role label  [ Regional Manager        ] │
│ Personality                             │
│ ┌─────────────────────────────────────┐ │
│ │ Well-meaning but attention-seeking. │ │
│ │ ...                                 │ │
│ └─────────────────────────────────────┘ │
│ Values                                  │
│ ┌─────────────────────────────────────┐ │
│ │ Being liked. Office camaraderie.    │ │
│ │ ...                                 │ │
│ └─────────────────────────────────────┘ │
│ Baseline output  [ 12  ]                │
└─────────────────────────────────────────┘
```

- "Load preset" pulls from `packages/shared/src/presets.ts` (see `presets.md`).
- Selecting a preset overwrites all five fields. Editing after is fine; the
  preset dropdown shows "(custom)" once any field diverges.
- On first visit (no localStorage), pre-load Michael for manager and Jim for
  worker so the user lands on a runnable form.

### Sim params

```
┌─────────────────────────────────────────┐
│ Simulation parameters                   │
│                                         │
│ Sales target  [ 500  ] units            │
│ Rounds        [ 10   ]                  │
│ Model         [ gpt-4.1            ▼ ]  │
│ Temperature   [ 0.8  ]                  │
└─────────────────────────────────────────┘
```

Reasonable defaults pre-filled. Model dropdown: `gpt-4.1`, `gpt-4o`,
`gpt-4o-mini`. Temperature: number input, 0–2.

### Submit behavior

```ts
async function onRun() {
  const res = await fetch('/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agents: [managerForm, workerForm],
      target_paper: targetPaper,
      rounds_total: roundsTotal,
      model,
      temperature,
    }),
  });
  const { id } = await res.json();
  navigate(`/runs/${id}`);
}
```

Validate client-side before POSTing (Zod schema shared with the API via
`packages/shared`).

### Persistence

Persist the last-used form values in `localStorage` so reload doesn't lose
work. Keyed by `'work-sim:setup-draft'`.

---

## Screen 3 — Run detail (`/runs/:id`)

The most important screen. Shows a run as it unfolds (or after it's done).

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ ◀ Back to runs                                                      │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Michael Scott  →  Jim Halpert                                   │ │
│ │ Round 7 of 10  •  Target 500  •  Sold 312  •  ahead of pace     │ │
│ │ ████████████████████░░░░░░░░░░░░░░░░  62%                      │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ┌──────────────────────────┐  ┌──────────────────────────────────┐  │
│ │ Transcript               │  │ Morale over time                 │  │
│ │                          │  │                                  │  │
│ │ ── Round 1 ──            │  │     ▲                            │  │
│ │ [routine_check_in]       │  │ 100 │                            │  │
│ │ Michael: Hey Jim! ...    │  │  75 │  ●─●                       │  │
│ │ Jim: Sure thing ...      │  │  50 │     ●─●─●                  │  │
│ │ morale 68 • 14 sold      │  │  25 │           ●                │  │
│ │                          │  │   0 └─────────────────────▶ rnd  │  │
│ │ ── Round 2 ──            │  │                                  │  │
│ │ [missed_target]          │  │ Paper sold this round            │  │
│ │ Michael: I need ...      │  │ ▓▓▓▓ ▓▓▓▓▓ ▓▓▓ ▓▓ ▓▓▓▓ ...        │  │
│ │ ...                      │  │                                  │  │
│ │ ⠋ generating round 8...  │  │                                  │  │
│ └──────────────────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Header

- Agent names + arrow (manager → worker).
- Current round / total.
- Target / sold / pace.
- Progress bar = `paper_total / target_paper`.
- Status pill (pending/running/completed/failed).

### Transcript (left column)

- One block per completed round. Within a block:
  - Round number + situation tag (small, muted).
  - Manager line.
  - Worker line.
  - Footer: morale + paper sold (small, muted).
- A "generating round N…" placeholder appears at the bottom while `status =
  running` and the latest `rounds.length < rounds_completed`.
- Auto-scroll to bottom when a new round arrives, **unless** the user has
  scrolled up (track `scrollTop` to avoid yanking them around).
- Click a round's situation tag to see its description in a tooltip.

### Right column

- **Morale curve.** Simple line chart, x = round, y = 0–100. Use Recharts
  (lightweight, sufficient).
- **Paper sold per round bar chart.** Same Recharts dependency.
- After completion, a banner: ✓ "Hit target: 520/500" (green) or ✗
  "Missed target: 380/500" (red).

### Failed state

If `status === 'failed'`:

- Banner at top: red, "Run failed at round N." + `error_message`.
- Transcript renders all rounds successfully completed before the failure.
- "Start a new run with the same config" button (POSTs to `/runs` with the
  same `config_json` payload, defer if not trivial).

---

## Polling

Hook lives in `apps/web/src/hooks/use-run-polling.ts`.

```ts
export function useRunPolling(id: string) {
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await fetchRun(id);
        if (cancelled) return;
        setRun(r);
        if (r.status === 'pending' || r.status === 'running') {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        // On transient error, back off and retry.
        if (cancelled) return;
        timer = setTimeout(poll, 5000);
      }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);
  return run;
}
```

Key rules:

- Always do an initial fetch immediately on mount.
- Stop polling on terminal status.
- Back off (5s) on errors instead of hammering.
- Cancel on unmount (cleanup function).
- No `setInterval` — chained `setTimeout` so we never have overlapping
  in-flight requests.

---

## Component layout

```
apps/web/src/
├── App.tsx                       # Router + global Layout
├── routes/
│   ├── runs-list.tsx             # /
│   ├── new-run.tsx               # /new
│   └── run-detail.tsx            # /runs/:id
├── components/
│   ├── layout.tsx                # nav + container
│   ├── agent-form.tsx            # one panel; takes role + value/onChange
│   ├── preset-dropdown.tsx
│   ├── transcript.tsx            # list of round blocks
│   ├── round-block.tsx
│   ├── morale-chart.tsx          # Recharts wrapper
│   ├── paper-chart.tsx
│   ├── status-pill.tsx
│   └── progress-bar.tsx
├── hooks/
│   ├── use-run-polling.ts
│   └── use-runs.ts               # for the list view's gentler polling
├── api.ts                        # fetch wrappers + types
└── main.tsx
```

---

## Tailwind / styling

- Vanilla Tailwind, no UI library in v1 (no shadcn, no MUI). Forms use plain
  `<input>`/`<textarea>` with Tailwind classes; modals are unnecessary.
- Define a tiny set of utility classes in `index.css`:

```css
@layer components {
  .btn-primary { @apply px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700; }
  .btn-secondary { @apply px-4 py-2 border border-gray-300 rounded hover:bg-gray-50; }
  .input { @apply w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none; }
  .label { @apply block text-sm font-medium text-gray-700 mb-1; }
}
```

That's the full design system for the prototype.

---

## What the frontend does NOT do in v1

- No optimistic UI for `POST /runs` (we wait for the response — it's fast).
- No streaming token-by-token rendering of LLM output.
- No mid-run controls (pause/cancel/inject) — schema and API reserve slots
  but UI doesn't expose them.
- No experiment grouping view.
- No comparison between runs (side-by-side, overlaid morale curves).
- No saved user-authored agent profiles ("save as preset").
- No keyboard shortcuts.
- No dark mode (default light, plain).
- No login/auth UI.
