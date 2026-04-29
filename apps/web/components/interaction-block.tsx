// One interaction in the avatar drilldown view. Replaces the old
// `round-block.tsx` from the single-worker prototype. Renders one exchange
// (manager 1:1 or peer convo) with both messages plus the relevant morale
// fields.
//
// Visual cues:
// - Header line: "Round N · order K · {situation_tag}" + "manager 1:1" or
//   "peer" pill, derived from participants' roles.
// - Direction badge relative to the focused avatar: "you initiated" /
//   "you responded".
// - Manager rows have no initiator-side morale (locked-decisions §15).

'use client';

import type { AvatarView, InteractionView } from '@work-sim/shared';
import { SITUATION_TAGS } from '@work-sim/shared';

export interface InteractionBlockProps {
  interaction: InteractionView;
  /** Avatar whose drilldown we're rendering — drives the "you initiated/responded" badge. */
  focusAvatar: AvatarView;
  /** All avatars in the run, used to render names + roles. */
  avatars: AvatarView[];
}

/** Linear lookup is fine — N is small per design.md §1. */
function findAvatar(avatars: AvatarView[], id: string): AvatarView | undefined {
  return avatars.find((a) => a.id === id);
}

/**
 * Manager-vs-peer is derived from participants' role_in_sim — there is no
 * `phase` column in the schema (design.md §2 + §11).
 */
function classify(initiator: AvatarView | undefined, responder: AvatarView | undefined):
  | 'manager-1on1'
  | 'peer'
  | 'unknown' {
  if (!initiator || !responder) return 'unknown';
  if (initiator.role_in_sim === 'manager' || responder.role_in_sim === 'manager') {
    return 'manager-1on1';
  }
  return 'peer';
}

export function InteractionBlock({ interaction, focusAvatar, avatars }: InteractionBlockProps) {
  const initiator = findAvatar(avatars, interaction.initiator_avatar_id);
  const responder = findAvatar(avatars, interaction.responder_avatar_id);
  const kind = classify(initiator, responder);

  const tagDesc = SITUATION_TAGS.find((t) => t.tag === interaction.situation_tag)?.description;
  const focusInitiated = interaction.initiator_avatar_id === focusAvatar.id;
  const focusIsManager = focusAvatar.role_in_sim === 'manager';

  // The "self_perception" / "morale" fields on the focused avatar's side are
  // private. We render them on the focused avatar's lines but not on the
  // partner's lines, even though the partner's are present in the data.
  // (This is a UI-level cue — the wire shape carries everything.)

  return (
    <article className="py-4 border-b last:border-b-0">
      <header className="flex items-center justify-between gap-3 mb-2">
        <div className="text-xs text-gray-500 uppercase tracking-wide">
          Round {interaction.round_index} · order {interaction.order_in_round}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 cursor-help"
            title={tagDesc ?? interaction.situation_tag}
          >
            {interaction.situation_tag}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              kind === 'manager-1on1'
                ? 'bg-purple-50 text-purple-800'
                : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            {kind === 'manager-1on1' ? 'manager 1:1' : 'peer'}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-800">
            {focusInitiated ? 'you initiated' : 'you responded'}
          </span>
        </div>
      </header>

      {/* Initiator line. */}
      <p className="text-sm mb-2 whitespace-pre-wrap">
        <strong className="text-gray-900">{initiator?.name ?? 'Initiator'}:</strong>{' '}
        <span className="text-gray-800">{interaction.initiator_message}</span>
      </p>

      {/* Initiator-side morale — only when initiator is not the manager AND
          the focused avatar is the initiator (private to that avatar). For
          all other rows (responder-side, or someone else's drilldown) we
          omit these to keep the prompt scoping intuitions visible in the UI. */}
      {focusInitiated &&
        !focusIsManager &&
        interaction.initiator_morale !== null && (
          <div className="ml-4 mb-2 text-xs text-gray-500">
            <div>
              <span className="text-gray-400">your morale:</span>{' '}
              {interaction.initiator_morale}
            </div>
            {interaction.initiator_morale_rationale && (
              <div>
                <span className="text-gray-400">why:</span>{' '}
                {interaction.initiator_morale_rationale}
              </div>
            )}
            {interaction.initiator_self_perception && (
              <div>
                <span className="text-gray-400">self-perception:</span>{' '}
                {interaction.initiator_self_perception}
              </div>
            )}
          </div>
        )}

      {/* Responder line. */}
      <p className="text-sm mb-2 whitespace-pre-wrap">
        <strong className="text-gray-900">{responder?.name ?? 'Responder'}:</strong>{' '}
        <span className="text-gray-800">{interaction.responder_message}</span>
      </p>

      {/* Responder-side morale — present whenever the focused avatar IS the responder. */}
      {!focusInitiated && (
        <div className="ml-4 mb-2 text-xs text-gray-500">
          <div>
            <span className="text-gray-400">your morale:</span>{' '}
            {interaction.responder_morale}
          </div>
          <div>
            <span className="text-gray-400">why:</span>{' '}
            {interaction.responder_morale_rationale}
          </div>
          <div>
            <span className="text-gray-400">self-perception:</span>{' '}
            {interaction.responder_self_perception}
          </div>
        </div>
      )}
    </article>
  );
}
