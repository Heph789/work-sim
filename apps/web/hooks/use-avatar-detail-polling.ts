// Polling hook for the avatar drilldown screen. Mirrors useRunPolling but
// targets GET /runs/:id/avatars/:avatarId — the dashboard endpoint excludes
// interactions (design.md §14.1), so the drilldown page polls this endpoint
// to live-update the per-avatar interaction feed and morale curve.
//
// Pairs with useRunPolling on the same page to drive the run-level status
// pill; this hook owns just the per-avatar payload.

'use client';

import { useEffect, useState } from 'react';
import type { AvatarDetail } from '@work-sim/shared';
import { fetchAvatarDetail, RunNotFoundError } from '@/lib/api';

const ACTIVE_INTERVAL_MS = 2000;
const ERROR_BACKOFF_MS = 5000;

export interface UseAvatarDetailPollingResult {
  detail: AvatarDetail | null;
  notFound: boolean;
  error: Error | null;
}

/**
 * Subscribe to live drilldown state for one avatar. Caller is responsible
 * for stopping polling on terminal run status by passing `paused = true`.
 */
export function useAvatarDetailPolling(
  runId: string,
  avatarId: string,
  opts: { partner?: string; paused?: boolean } = {},
): UseAvatarDetailPollingResult {
  const { partner, paused = false } = opts;
  const [detail, setDetail] = useState<AvatarDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setDetail(null);
    setNotFound(false);
    setError(null);

    async function poll() {
      try {
        const d = await fetchAvatarDetail(runId, avatarId, partner);
        if (cancelled) return;
        setDetail(d);
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
        setError(err instanceof Error ? err : new Error('drilldown fetch failed'));
        timer = setTimeout(poll, ERROR_BACKOFF_MS);
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, avatarId, partner, paused]);

  return { detail, notFound, error };
}
