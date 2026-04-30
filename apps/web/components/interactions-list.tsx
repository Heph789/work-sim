// Shared "list of interactions, grouped by round" component.
//
// Source data is `DrilldownInteraction[]` — the only place interactions live
// in the wire shape (design.md §14.2 / api.md). Names are embedded on each
// interaction's `initiator` / `responder`, so this component does not need a
// separate avatars list.
//
// Grouping rationale: round_index + situation_tag are per-round properties.
// Showing them once per group is denser and easier to scan than once per
// interaction. Within a group, items are sorted by `order_in_round`.

'use client';

import type { DrilldownInteraction, DrilldownRoundEntry } from '@work-sim/shared';
import { SITUATION_TAGS } from '@work-sim/shared';
import { InteractionBlock, type FocusAvatar } from './interaction-block';

export interface InteractionsListProps {
  /** Interactions to render. Caller may pre-filter (e.g. drilldown filters). */
  interactions: DrilldownInteraction[];
  /** When set, each block is rendered in drilldown mode (direction badge, focused-side morale). */
  focusAvatar?: FocusAvatar;
  /**
   * Optional map from round_index → focused avatar's per-round entry. When
   * provided, each round group header surfaces the subject's end-of-round
   * morale + self_perception. Only meaningful in drilldown mode (focusAvatar set).
   */
  roundEntriesByIndex?: ReadonlyMap<number, DrilldownRoundEntry>;
  /** Override for the empty-state copy. Defaults to a generic message. */
  emptyMessage?: string;
}

interface RoundGroup {
  roundIndex: number;
  situationTag: string;
  items: DrilldownInteraction[];
}

/** Group interactions by round_index, preserving order_in_round within each group. */
function groupByRound(interactions: DrilldownInteraction[]): RoundGroup[] {
  const byRound = new Map<number, DrilldownInteraction[]>();
  for (const it of interactions) {
    const arr = byRound.get(it.round_index) ?? [];
    arr.push(it);
    byRound.set(it.round_index, arr);
  }
  const groups: RoundGroup[] = [];
  for (const [roundIndex, items] of byRound) {
    items.sort((a, b) => a.order_in_round - b.order_in_round);
    groups.push({
      roundIndex,
      // situation_tag is per-round and denormalized onto every interaction in
      // the round; pick from any one of them.
      situationTag: items[0]!.situation_tag,
      items,
    });
  }
  groups.sort((a, b) => a.roundIndex - b.roundIndex);
  return groups;
}

export function InteractionsList({
  interactions,
  focusAvatar,
  roundEntriesByIndex,
  emptyMessage = 'No interactions yet.',
}: InteractionsListProps) {
  if (interactions.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic py-6 text-center">
        {emptyMessage}
      </div>
    );
  }

  const groups = groupByRound(interactions);

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const tagDesc = SITUATION_TAGS.find((t) => t.tag === group.situationTag)?.description;
        const entry = roundEntriesByIndex?.get(group.roundIndex);
        return (
          <section key={group.roundIndex}>
            <header className="mb-2 pb-1 border-b border-gray-200 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700">
                Round {group.roundIndex}
              </h3>
              <span
                className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 cursor-help"
                title={tagDesc ?? group.situationTag}
              >
                {group.situationTag}
              </span>
              {entry?.morale !== null && entry?.morale !== undefined && (
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400">end-of-round morale:</span> {entry.morale}
                </span>
              )}
            </header>
            <div className="ml-2">
              {group.items.map((it) => (
                <InteractionBlock
                  key={it.id}
                  interaction={it}
                  focusAvatar={focusAvatar}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
