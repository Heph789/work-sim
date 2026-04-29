// One interaction (manager 1:1 or peer convo) rendered as a block: header +
// both messages + a morale-delta block at the bottom.
//
// Two modes:
// - Drilldown (focusAvatar set): the block is part of a single avatar's
//   timeline. The morale block shows only the focused avatar's side
//   (information asymmetry — partner-side morale is private to the partner).
//   A direction badge identifies whether the focused avatar initiated or
//   responded.
// - Overview (focusAvatar omitted): the block is part of a run-wide
//   timeline. The morale block shows whichever sides have non-null morale
//   data, labeled by avatar name. No direction badge.
//
// Round number + situation_tag are intentionally NOT in this block — the
// parent (InteractionsList) groups by round and renders that chrome once
// per round, not once per interaction.

'use client';

import type { AvatarRole, DrilldownInteraction } from '@work-sim/shared';

/** Minimum focus shape: matches the embedded participant on DrilldownInteraction. */
export interface FocusAvatar {
  id: string;
  name: string;
  role_in_sim: AvatarRole;
}

export interface InteractionBlockProps {
  interaction: DrilldownInteraction;
  /**
   * If set, the block is part of this avatar's drilldown timeline. Drives the
   * direction badge and restricts the morale block to the focused side only.
   * Omit for the run-wide overview list.
   */
  focusAvatar?: FocusAvatar;
}

/**
 * Manager-vs-peer is derived from participants' role_in_sim — there is no
 * `phase` column in the schema (design.md §2 + §11).
 */
function classify(initiatorRole: AvatarRole, responderRole: AvatarRole):
  | 'manager-1on1'
  | 'peer' {
  if (initiatorRole === 'manager' || responderRole === 'manager') {
    return 'manager-1on1';
  }
  return 'peer';
}

interface MoraleEntryProps {
  name: string;
  delta: number;
  rationale: string | null;
}

function MoraleEntry({ name, delta, rationale }: MoraleEntryProps) {
  const sign = delta > 0 ? '+' : '';
  return (
    <div>
      <div>
        <span className="text-gray-400">{name} morale Δ:</span> {sign}
        {delta}
      </div>
      {rationale && (
        <div>
          <span className="text-gray-400">why:</span> {rationale}
        </div>
      )}
    </div>
  );
}

export function InteractionBlock({ interaction, focusAvatar }: InteractionBlockProps) {
  const { initiator, responder } = interaction;
  const kind = classify(initiator.role_in_sim, responder.role_in_sim);

  const focusInitiated = focusAvatar ? initiator.id === focusAvatar.id : false;
  const focusIsManager = focusAvatar?.role_in_sim === 'manager';

  // Decide which sides' morale-delta to render.
  // - Drilldown: only the focused avatar's side, and only when meaningful
  //   (managers have null morale in v1).
  // - Overview: every side that has a non-null delta.
  const showInitiatorMorale = focusAvatar
    ? focusInitiated && !focusIsManager && interaction.initiator_morale_delta !== null
    : interaction.initiator_morale_delta !== null;
  const showResponderMorale = focusAvatar ? !focusInitiated : true;
  const hasMorale = showInitiatorMorale || showResponderMorale;

  return (
    <article className="py-4 border-b last:border-b-0">
      <header className="flex items-center justify-between gap-3 mb-2">
        <div className="text-xs text-gray-500 uppercase tracking-wide">
          order {interaction.order_in_round}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              kind === 'manager-1on1'
                ? 'bg-purple-50 text-purple-800'
                : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            {kind === 'manager-1on1' ? 'manager 1:1' : 'peer'}
          </span>
          {focusAvatar && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-800">
              {focusAvatar.name} {focusInitiated ? 'initiated' : 'responded'}
            </span>
          )}
        </div>
      </header>

      <p className="text-sm mb-2 whitespace-pre-wrap">
        <strong className="text-gray-900">{initiator.name}:</strong>{' '}
        <span className="text-gray-800">{interaction.initiator_message}</span>
      </p>

      <p className="text-sm mb-2 whitespace-pre-wrap">
        <strong className="text-gray-900">{responder.name}:</strong>{' '}
        <span className="text-gray-800">{interaction.responder_message}</span>
      </p>

      {hasMorale && (
        <div className="ml-4 mt-2 space-y-2 text-xs text-gray-500">
          {showInitiatorMorale && interaction.initiator_morale_delta !== null && (
            <MoraleEntry
              name={initiator.name}
              delta={interaction.initiator_morale_delta}
              rationale={interaction.initiator_morale_rationale}
            />
          )}
          {showResponderMorale && (
            <MoraleEntry
              name={responder.name}
              delta={interaction.responder_morale_delta}
              rationale={interaction.responder_morale_rationale}
            />
          )}
        </div>
      )}
    </article>
  );
}
