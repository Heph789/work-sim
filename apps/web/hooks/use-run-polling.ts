// Polling hook for the run-detail screen. Fetches GET /runs/:id every 2s while
// the run is non-terminal; stops once status is completed | failed | cancelled.
//
// Uses chained setTimeout (NOT setInterval) so we never have overlapping
// in-flight requests. Backs off to 5s on transient errors. Cancels on unmount.
//
// Implementation directly mirrors the sketch in
// docs/initial-prototype/frontend.md.

'use client';

import { useEffect, useState } from 'react';
import type { RunDetail } from '@work-sim/shared';
import { getRun } from '@/lib/api';

/** Polling cadence while the run is in a non-terminal state. */
const ACTIVE_INTERVAL_MS = 2000;
/** Backoff cadence after a transient error. */
const ERROR_BACKOFF_MS = 5000;

/**
 * Subscribe to live run state. Returns `null` until the first fetch resolves,
 * then the latest RunDetail every poll. Polling stops automatically on
 * terminal status; the hook also tears down cleanly on unmount.
 */
export function useRunPolling(id: string): RunDetail | null {
  const [run, setRun] = useState<RunDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const r = await getRun(id);
        if (cancelled) return;
        setRun(r);
        if (r.status === 'pending' || r.status === 'running') {
          timer = setTimeout(poll, ACTIVE_INTERVAL_MS);
        }
        // Terminal statuses (completed | failed | cancelled): stop scheduling.
      } catch {
        if (cancelled) return;
        // TODO: distinguish RunNotFoundError → set a "not found" state instead
        // of looping forever. For other errors, back off and retry.
        timer = setTimeout(poll, ERROR_BACKOFF_MS);
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return run;
}
