// Polling hook for the runs list screen. Gentler cadence than use-run-polling
// (5s vs 2s) because the list view is scanned, not watched.
//
// Stops polling once every row is in a terminal state — no point hammering
// the API for a list that won't change. Resumes polling when a new run is
// created (the list page refetches on mount, and a fresh row will be
// non-terminal until the runner completes it).

'use client';

import { useEffect, useState } from 'react';
import type { RunListItem } from '@work-sim/shared';
import { listRuns } from '@/lib/api';

/** Polling cadence while any row is non-terminal. */
const LIST_INTERVAL_MS = 5000;

/** Set of statuses that mean "done; will not change again". */
const TERMINAL: ReadonlySet<RunListItem['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/**
 * Returned shape mirrors a typical react-query result minus the bells: the
 * loaded list, an `error` if the most recent fetch failed, and a `loading`
 * boolean that's only true on the very first fetch.
 */
export interface UseRunsResult {
  runs: RunListItem[];
  loading: boolean;
  error: Error | null;
}

/** Fetch + poll the runs list, stopping once everything is terminal. */
export function useRuns(): UseRunsResult {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const { runs: next } = await listRuns();
        if (cancelled) return;
        setRuns(next);
        setError(null);
        // TODO: only schedule next tick if some row is non-terminal.
        const anyActive = next.some((r) => !TERMINAL.has(r.status));
        if (anyActive) {
          timer = setTimeout(poll, LIST_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error('list fetch failed'));
        timer = setTimeout(poll, LIST_INTERVAL_MS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { runs, loading, error };
}
