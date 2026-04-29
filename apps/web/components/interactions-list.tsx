// Shared "list of interactions, grouped by round" component. Used in two
// places:
// - The dashboard (run overview) — full list, no focus avatar.
// - The avatar drilldown — pre-filtered to one avatar's interactions, with
//   `focusAvatar` set so each block gets a direction badge and the right
//   morale-side display. The drilldown's filter UI is owned by its caller
//   (avatar-interactions-list.tsx); this component just renders.
//
// Grouping rationale: round_index + situation_tag are per-round properties.
// Showing them once per group is denser and easier to scan than once per
// interaction. Within a group, items are sorted by `order_in_round`.

'use client';

import type { AvatarView, InteractionView } from '@work-sim/shared';
import { SITUATION_TAGS } from '@work-sim/shared';
import { InteractionBlock } from './interaction-block';

export interface InteractionsListProps {
  /** Interactions to render. Caller may pre-filter (e.g. drilldown filters). */
  interactions: InteractionView[];
  /** All avatars in the run, used to render names + roles. */
  avatars: AvatarView[];
  /** When set, each block is rendered in drilldown mode (direction badge, focused-side morale). */
  focusAvatar?: AvatarView;
  /** Override for the empty-state copy. Defaults to a generic message. */
  emptyMessage?: string;
}

interface RoundGroup {
  roundIndex: number;
  situationTag: string;
  items: InteractionView[];
}

/** Group interactions by round_index, preserving order_in_round within each group. */
function groupByRound(interactions: InteractionView[]): RoundGroup[] {
  const byRound = new Map<number, InteractionView[]>();
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
  avatars,
  focusAvatar,
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
        return (
          <section key={group.roundIndex}>
            <header className="flex items-center gap-2 mb-2 pb-1 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700">
                Round {group.roundIndex}
              </h3>
              <span
                className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 cursor-help"
                title={tagDesc ?? group.situationTag}
              >
                {group.situationTag}
              </span>
            </header>
            <div className="ml-2">
              {group.items.map((it) => (
                <InteractionBlock
                  key={it.id}
                  interaction={it}
                  avatars={avatars}
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
