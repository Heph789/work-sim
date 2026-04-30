// Dev-only scenario picker. Renders a small <select> in the runs list page
// header when NEXT_PUBLIC_USE_MOCK is on. Picking a scenario hard-navigates
// to /?scenario=<name>; lib/api.ts forwards that query onto every API fetch
// and the route handler Set-Cookies it for cross-page navigation.
//
// Hidden completely in real-backend mode.
//
// Why a full window.location.assign rather than router.replace? router.replace
// only updates the URL — it doesn't restart the polling loops in useRuns /
// useRunPolling, so a freshly-picked scenario would only land at the next 5s
// tick, and the in-flight component state (existing rows, sparkline series)
// would briefly mix old and new scenario data. A full nav remounts the page
// and produces an instant, clean swap.

'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SCENARIO_NAMES } from '@/lib/mock/scenarios';

const ENABLED = process.env.NEXT_PUBLIC_USE_MOCK !== 'false';

export function DevScenarioPicker() {
  if (!ENABLED) return null;
  return (
    <Suspense fallback={null}>
      <DevScenarioPickerInner />
    </Suspense>
  );
}

function DevScenarioPickerInner() {
  const search = useSearchParams();
  const active = search.get('scenario') ?? '';

  return (
    <label className="flex items-center gap-2 text-xs text-gray-500">
      <span>scenario</span>
      <select
        className="border border-gray-200 rounded px-1 py-0.5 text-xs bg-white"
        value={active}
        onChange={(e) => {
          const v = e.target.value;
          window.location.assign(v ? `/?scenario=${encodeURIComponent(v)}` : '/');
        }}
      >
        <option value="">(cookie)</option>
        {SCENARIO_NAMES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
