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
import { getRun, RunNotFoundError } from '@/lib/api';

const ACTIVE_INTERVAL_MS = 2000;
const ERROR_BACKOFF_MS = 5000;

export interface UseRunPollingResult {
  /** Latest detail snapshot, or null until the first successful fetch. */
  run: RunDetail | null;
  /** True once the API has returned 404 for this id; polling stops. */
  notFound: boolean;
  /** Most recent transient error; cleared on the next successful fetch. */
  error: Error | null;
}

/**
 * Subscribe to live run state. Polling stops automatically on terminal status
 * (completed | failed | cancelled) or 404; the hook also tears down cleanly on
 * unmount.
 */
export function useRunPolling(id: string): UseRunPollingResult {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setRun(null);
    setNotFound(false);
    setError(null);

    async function poll() {
      try {
        const r = await getRun(id);
        if (cancelled) return;
        setRun(r);
        setError(null);
        if (r.status === 'pending' || r.status === 'running') {
          timer = setTimeout(poll, ACTIVE_INTERVAL_MS);
        }
        // Terminal statuses (completed | failed | cancelled): stop scheduling.
      } catch (err) {
        if (cancelled) return;
        if (err instanceof RunNotFoundError) {
          setNotFound(true);
          return; // stop polling — the row is gone for good
        }
        setError(err instanceof Error ? err : new Error('run fetch failed'));
        timer = setTimeout(poll, ERROR_BACKOFF_MS);
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return { run, notFound, error };
}
