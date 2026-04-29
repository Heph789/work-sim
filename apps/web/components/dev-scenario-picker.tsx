// Dev-only scenario picker. Renders a small <select> in the runs list page
// header when NEXT_PUBLIC_USE_MOCK is on. Picking a scenario navigates to
// /?scenario=<name>; the route handler reads the query, sets a cookie, and
// future requests use it automatically.
//
// Hidden completely in real-backend mode.

'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SCENARIO_NAMES } from '@/lib/mock/scenarios';

const ENABLED = process.env.NEXT_PUBLIC_USE_MOCK !== 'false';

/**
 * Tiny labeled <select> wired to ?scenario=… in the URL. Reads the active
 * scenario from the query string when present so refresh persists the
 * selection visually. Wrapped in Suspense per Next 15's CSR-bailout rule
 * for useSearchParams.
 */
export function DevScenarioPicker() {
  if (!ENABLED) return null;
  return (
    <Suspense fallback={null}>
      <DevScenarioPickerInner />
    </Suspense>
  );
}

function DevScenarioPickerInner() {
  const router = useRouter();
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
          // Navigate to the same path with ?scenario=…; the route handler
          // sets the cookie. Use replace to avoid back-button noise.
          if (!v) {
            router.replace('/');
          } else {
            router.replace(`/?scenario=${encodeURIComponent(v)}`);
          }
          // Force a re-fetch of any in-flight data by hard-refreshing the route.
          router.refresh();
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
