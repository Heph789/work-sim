// Polling hook for the run-level interactions feed. Targets
// GET /runs/:id/interactions — the dashboard endpoint excludes interactions
// (design.md §14.1), so the run overview polls this separately to live-update
// the full interactions list.
//
// Pairs with useRunPolling on the dashboard: that hook owns status/per-avatar
// state, this one owns interactions. Caller passes `paused = true` once the
// run hits a terminal status to stop scheduling further polls.

'use client';

import { useEffect, useState } from 'react';
import type { DrilldownInteraction } from '@work-sim/shared';
import { getRunInteractions, RunNotFoundError } from '@/lib/api';

const ACTIVE_INTERVAL_MS = 2000;
const ERROR_BACKOFF_MS = 5000;

export interface UseRunInteractionsPollingResult {
  interactions: DrilldownInteraction[] | null;
  notFound: boolean;
  error: Error | null;
}

export function useRunInteractionsPolling(
  runId: string,
  opts: { paused?: boolean } = {},
): UseRunInteractionsPollingResult {
  const { paused = false } = opts;
  const [interactions, setInteractions] = useState<DrilldownInteraction[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setInteractions(null);
    setNotFound(false);
    setError(null);

    async function poll() {
      try {
        const feed = await getRunInteractions(runId);
        if (cancelled) return;
        setInteractions(feed.interactions);
        setError(null);
        if (!paused) {
          timer = setTimeout(poll, ACTIVE_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof RunNotFoundError) {
          setNotFound(true);
          return;
        }
        setError(err instanceof Error ? err : new Error('interactions fetch failed'));
        timer = setTimeout(poll, ERROR_BACKOFF_MS);
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, paused]);

  return { interactions, notFound, error };
}
