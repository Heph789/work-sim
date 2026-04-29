// Filterable list of an avatar's interactions, used on the drilldown page.
// Owns its own filter UI; the parent passes the full filtered/unfiltered
// data and the active filter values via query string.
//
// Filters (per docs/many-workers/design.md §14.2 / §14.3):
// - Round filter: a single round_index, or "all".
// - Partner filter: a specific other-avatar id, or "all". Partner=specific
//   maps to the §14.3 "pair filter" (no separate route — query string).

'use client';

import type { AvatarView, InteractionView } from '@work-sim/shared';
import { InteractionBlock } from './interaction-block';

export interface AvatarInteractionsListProps {
  /** Whose drilldown this is. */
  focusAvatar: AvatarView;
  /** All avatars in the run — used to populate the partner filter and resolve names. */
  avatars: AvatarView[];
  /**
   * Interactions involving `focusAvatar` (either side), sorted by
   * (round_index, order_in_round). Parent has already pre-filtered to
   * just-this-avatar's rows.
   */
  interactions: InteractionView[];
  /** Active round filter ('all' or a round_index). */
  roundFilter: number | 'all';
  /** Active partner filter ('all' or partner avatar id). */
  partnerFilter: string | 'all';
  /** Called when the user picks a different round filter. */
  onRoundFilterChange: (next: number | 'all') => void;
  /** Called when the user picks a different partner filter. */
  onPartnerFilterChange: (next: string | 'all') => void;
}

/** Apply the active filter pair to the interactions list. */
function applyFilters(
  interactions: InteractionView[],
  focusId: string,
  roundFilter: number | 'all',
  partnerFilter: string | 'all',
): InteractionView[] {
  return interactions.filter((it) => {
    if (roundFilter !== 'all' && it.round_index !== roundFilter) return false;
    if (partnerFilter !== 'all') {
      const partnerId =
        it.initiator_avatar_id === focusId
          ? it.responder_avatar_id
          : it.initiator_avatar_id;
      if (partnerId !== partnerFilter) return false;
    }
    return true;
  });
}

/**
 * Distinct round indexes present in `interactions`, ascending. Used to
 * populate the round filter dropdown so empty rounds don't show up.
 */
function distinctRounds(interactions: InteractionView[]): number[] {
  const set = new Set<number>();
  for (const it of interactions) set.add(it.round_index);
  return [...set].sort((a, b) => a - b);
}

/**
 * Distinct partner avatar ids present in `interactions`, in first-seen order.
 * (Sorting by name happens in the JSX where we have access to avatar objects.)
 */
function distinctPartners(interactions: InteractionView[], focusId: string): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const it of interactions) {
    const partnerId =
      it.initiator_avatar_id === focusId
        ? it.responder_avatar_id
        : it.initiator_avatar_id;
    if (!set.has(partnerId)) {
      set.add(partnerId);
      seen.push(partnerId);
    }
  }
  return seen;
}

export function AvatarInteractionsList({
  focusAvatar,
  avatars,
  interactions,
  roundFilter,
  partnerFilter,
  onRoundFilterChange,
  onPartnerFilterChange,
}: AvatarInteractionsListProps) {
  const filtered = applyFilters(interactions, focusAvatar.id, roundFilter, partnerFilter);
  const rounds = distinctRounds(interactions);
  const partnerIds = distinctPartners(interactions, focusAvatar.id);
  const partnerOptions = partnerIds
    .map((id) => avatars.find((a) => a.id === id))
    .filter((a): a is AvatarView => a !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="bg-white border rounded p-4">
      <div className="flex flex-wrap gap-3 mb-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-gray-600">Round</span>
          <select
            className="input py-1"
            value={roundFilter === 'all' ? 'all' : String(roundFilter)}
            onChange={(e) => {
              const v = e.target.value;
              onRoundFilterChange(v === 'all' ? 'all' : Number(v));
            }}
          >
            <option value="all">all</option>
            {rounds.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-600">Partner</span>
          <select
            className="input py-1"
            value={partnerFilter}
            onChange={(e) => onPartnerFilterChange(e.target.value as string | 'all')}
          >
            <option value="all">all</option>
            {partnerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-gray-500 italic py-6 text-center">
          No interactions match these filters.
        </div>
      ) : (
        <div>
          {filtered.map((it) => (
            <InteractionBlock
              key={it.id}
              interaction={it}
              focusAvatar={focusAvatar}
              avatars={avatars}
            />
          ))}
        </div>
      )}
    </div>
  );
}
