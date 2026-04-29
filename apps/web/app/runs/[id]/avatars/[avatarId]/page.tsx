// Route: GET /runs/[id]/avatars/[avatarId]?round=&partner=
// Screen: Avatar drilldown (per docs/many-workers/design.md §14.2 + §14.3).
//
// One avatar's interactions across the run, plus a per-round morale chart.
// Filters live in the query string so they survive copy-paste links and
// page reloads.
//
// Behavior:
// - Reuses `useRunPolling(id)` so this page also live-updates while the run
//   is active. The interactions list slices to just-this-avatar's rows
//   client-side.
// - Round filter: `?round=N` (omit or `all` to disable).
// - Partner filter: `?partner=<avatarId>` (omit or `all` to disable). This is
//   the §14.3 pair-filter — same route, different query string.

'use client';

import { use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AvatarView, InteractionView, RoundAvatarView } from '@work-sim/shared';
import { useRunPolling } from '@/hooks/use-run-polling';
import { StatusPill } from '@/components/status-pill';
import { AvatarMoraleChart } from '@/components/avatar-morale-chart';
import { AvatarInteractionsList } from '@/components/avatar-interactions-list';

interface PageProps {
  params: Promise<{ id: string; avatarId: string }>;
}

/**
 * Pull only the interactions where the given avatar is either initiator or
 * responder, preserving the API's (round_index, order_in_round) ordering.
 */
function interactionsForAvatar(
  all: InteractionView[],
  avatarId: string,
): InteractionView[] {
  return all.filter(
    (it) =>
      it.initiator_avatar_id === avatarId || it.responder_avatar_id === avatarId,
  );
}

/**
 * Pull only the round_avatar rows for the given avatar, sorted by round_index.
 * Drives the per-avatar morale chart.
 */
function perRoundForAvatar(
  all: RoundAvatarView[],
  avatarId: string,
): RoundAvatarView[] {
  return all
    .filter((ra) => ra.avatar_id === avatarId)
    .sort((a, b) => a.round_index - b.round_index);
}

export default function AvatarDrilldownPage({ params }: PageProps) {
  const router = useRouter();
  const search = useSearchParams();
  const { id, avatarId } = use(params);
  const { run, notFound, error } = useRunPolling(id);

  // Parse filter query strings. Both default to "all" when missing/invalid.
  const roundParam = search.get('round');
  const partnerParam = search.get('partner');
  const roundFilter: number | 'all' =
    roundParam && roundParam !== 'all' && Number.isFinite(Number(roundParam))
      ? Number(roundParam)
      : 'all';
  const partnerFilter: string | 'all' =
    partnerParam && partnerParam !== 'all' ? partnerParam : 'all';

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

  if (notFound) {
    return (
      <>
        <Link href="/" className="text-sm text-gray-600 hover:underline">◀ Back to runs</Link>
        <div className="mt-6 bg-white border rounded p-8 text-center text-gray-700">
          Run <code className="text-sm">{id}</code> not found.
        </div>
      </>
    );
  }

  if (!run) {
    return (
      <>
        <Link href={`/runs/${id}`} className="text-sm text-gray-600 hover:underline">◀ Back to dashboard</Link>
        <div className="mt-6 text-sm text-gray-500">Loading run…</div>
        {error && (
          <div className="mt-3 text-sm text-red-700">
            Failed to load: {error.message}
          </div>
        )}
      </>
    );
  }

  const focus: AvatarView | undefined = run.avatars.find((a) => a.id === avatarId);
  if (!focus) {
    return (
      <>
        <Link href={`/runs/${id}`} className="text-sm text-gray-600 hover:underline">◀ Back to dashboard</Link>
        <div className="mt-6 bg-white border rounded p-8 text-center text-gray-700">
          Avatar <code className="text-sm">{avatarId}</code> is not part of this run.
        </div>
      </>
    );
  }

  const myInteractions = interactionsForAvatar(run.interactions, focus.id);
  const myPerRound = perRoundForAvatar(run.round_avatars, focus.id);

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
        <AvatarMoraleChart perRound={myPerRound} />

        {/* Right column reserved for per-avatar paper-sold chart or
            per-round summary. Left empty for now — the dashboard table
            already shows cumulative + last-round paper. */}
        <div />
      </div>

      <AvatarInteractionsList
        focusAvatar={focus}
        avatars={run.avatars}
        interactions={myInteractions}
        roundFilter={roundFilter}
        partnerFilter={partnerFilter}
        onRoundFilterChange={(v) => setQuery('round', v === 'all' ? 'all' : String(v))}
        onPartnerFilterChange={(v) => setQuery('partner', v)}
      />
    </>
  );
}
