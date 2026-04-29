// Avatar-drilldown-specific wrapper around InteractionsList. Owns the filter
// UI (round + partner) and delegates rendering to the shared list, which
// handles the round grouping + per-block layout.
//
// Filters (per docs/many-workers/design.md §14.2 / §14.3):
// - Round filter: a single round_index, or "all".
// - Partner filter: a specific other-avatar id, or "all". Partner=specific
//   maps to the §14.3 "pair filter" (no separate route — query string).

'use client';

import type { DrilldownInteraction } from '@work-sim/shared';
import { InteractionsList } from './interactions-list';
import type { FocusAvatar } from './interaction-block';

export interface AvatarInteractionsListProps {
  /** Whose drilldown this is. */
  focusAvatar: FocusAvatar;
  /**
   * Interactions involving `focusAvatar` (either side), sorted by
   * (round_index, order_in_round). Parent has already pre-filtered to
   * just-this-avatar's rows.
   */
  interactions: DrilldownInteraction[];
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
  interactions: DrilldownInteraction[],
  focusId: string,
  roundFilter: number | 'all',
  partnerFilter: string | 'all',
): DrilldownInteraction[] {
  return interactions.filter((it) => {
    if (roundFilter !== 'all' && it.round_index !== roundFilter) return false;
    if (partnerFilter !== 'all') {
      const partnerId = it.initiator.id === focusId ? it.responder.id : it.initiator.id;
      if (partnerId !== partnerFilter) return false;
    }
    return true;
  });
}

/**
 * Distinct round indexes present in `interactions`, ascending. Used to
 * populate the round filter dropdown so empty rounds don't show up.
 */
function distinctRounds(interactions: DrilldownInteraction[]): number[] {
  const set = new Set<number>();
  for (const it of interactions) set.add(it.round_index);
  return [...set].sort((a, b) => a - b);
}

interface PartnerOption {
  id: string;
  name: string;
}

/**
 * Distinct partners present in `interactions`, with names from the embedded
 * participant objects. Sorted by name for the dropdown.
 */
function distinctPartners(
  interactions: DrilldownInteraction[],
  focusId: string,
): PartnerOption[] {
  const seen = new Map<string, string>();
  for (const it of interactions) {
    const partner = it.initiator.id === focusId ? it.responder : it.initiator;
    if (!seen.has(partner.id)) {
      seen.set(partner.id, partner.name);
    }
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function AvatarInteractionsList({
  focusAvatar,
  interactions,
  roundFilter,
  partnerFilter,
  onRoundFilterChange,
  onPartnerFilterChange,
}: AvatarInteractionsListProps) {
  const filtered = applyFilters(interactions, focusAvatar.id, roundFilter, partnerFilter);
  const rounds = distinctRounds(interactions);
  const partnerOptions = distinctPartners(interactions, focusAvatar.id);

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

      <InteractionsList
        interactions={filtered}
        focusAvatar={focusAvatar}
        emptyMessage="No interactions match these filters."
      />
    </div>
  );
}
