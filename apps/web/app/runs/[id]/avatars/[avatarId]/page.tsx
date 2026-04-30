// Route: GET /runs/[id]/avatars/[avatarId]?round=&partner=
// Screen: Avatar drilldown (per docs/many-workers/design.md §14.2 + §14.3).
//
// One avatar's interactions across the run, plus a per-round morale chart.
// Filters live in the query string so they survive copy-paste links and
// page reloads.
//
// Behavior:
// - Polls GET /runs/:id for the run-level status pill, and GET
//   /runs/:id/avatars/:avatarId for the drilldown payload (interactions +
//   per-round morale). Both pause once the run reaches a terminal status.
// - Round filter: `?round=N` (omit or `all` to disable).
// - Partner filter: `?partner=<avatarId>` (omit or `all` to disable). This is
//   the §14.3 pair-filter — same route, different query string.

'use client';

import { use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRunPolling } from '@/hooks/use-run-polling';
import { useAvatarDetailPolling } from '@/hooks/use-avatar-detail-polling';
import { StatusPill } from '@/components/status-pill';
import { AvatarMoraleChart } from '@/components/avatar-morale-chart';
import { AvatarInteractionsList } from '@/components/avatar-interactions-list';

interface PageProps {
  params: Promise<{ id: string; avatarId: string }>;
}

export default function AvatarDrilldownPage({ params }: PageProps) {
  const router = useRouter();
  const search = useSearchParams();
  const { id, avatarId } = use(params);

  // Parse filter query strings. Both default to "all" when missing/invalid.
  const roundParam = search.get('round');
  const partnerParam = search.get('partner');
  const roundFilter: number | 'all' =
    roundParam && roundParam !== 'all' && Number.isFinite(Number(roundParam))
      ? Number(roundParam)
      : 'all';
  const partnerFilter: string | 'all' =
    partnerParam && partnerParam !== 'all' ? partnerParam : 'all';

  const { run, notFound: runNotFound, error: runError } = useRunPolling(id);
  const isTerminal =
    run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled';
  const {
    detail,
    notFound: detailNotFound,
    error: detailError,
  } = useAvatarDetailPolling(id, avatarId, {
    partner: partnerFilter === 'all' ? undefined : partnerFilter,
    paused: isTerminal,
  });

  /** Replace one query-string key while preserving the others; uses router.replace so back-button history isn't polluted. */
  const setQuery = useCallback(
    (key: 'round' | 'partner', value: string | 'all') => {
      const next = new URLSearchParams(search.toString());
      if (value === 'all') next.delete(key);
      else next.set(key, value);
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [search, router],
  );

  if (runNotFound || detailNotFound) {
    return (
      <>
        <Link href="/" className="text-sm text-gray-600 hover:underline">◀ Back to runs</Link>
        <div className="mt-6 bg-white border rounded p-8 text-center text-gray-700">
          {runNotFound ? (
            <>Run <code className="text-sm">{id}</code> not found.</>
          ) : (
            <>Avatar <code className="text-sm">{avatarId}</code> is not part of this run.</>
          )}
        </div>
      </>
    );
  }

  if (!detail || !run) {
    const err = detailError ?? runError;
    return (
      <>
        <Link href={`/runs/${id}`} className="text-sm text-gray-600 hover:underline">◀ Back to dashboard</Link>
        <div className="mt-6 text-sm text-gray-500">Loading avatar…</div>
        {err && (
          <div className="mt-3 text-sm text-red-700">
            Failed to load: {err.message}
          </div>
        )}
      </>
    );
  }

  const focus = detail.avatar;

  return (
    <>
      <Link href={`/runs/${id}`} className="text-sm text-gray-600 hover:underline">◀ Back to dashboard</Link>

      <header className="mt-4 mb-6 bg-white border rounded p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">{focus.name}</h2>
          <div className="text-sm text-gray-600">
            {focus.role_label} · {focus.role_in_sim}
          </div>
        </div>
        <StatusPill status={run.status} />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <AvatarMoraleChart
          perRound={detail.rounds}
          hasMoraleTrack={focus.role_in_sim === 'worker'}
        />

        {/* Right column reserved for per-avatar paper-sold chart or
            per-round summary. Left empty for now — the dashboard table
            already shows cumulative + last-round paper. */}
        <div />
      </div>

      <AvatarInteractionsList
        focusAvatar={focus}
        interactions={detail.interactions}
        rounds={detail.rounds}
        roundFilter={roundFilter}
        partnerFilter={partnerFilter}
        onRoundFilterChange={(v) => setQuery('round', v === 'all' ? 'all' : String(v))}
        onPartnerFilterChange={(v) => setQuery('partner', v)}
      />
    </>
  );
}
