// Transcript formatters used by the prompt builders. Three contexts; three
// shaping helpers. None of these include morale numbers, situation tags, or
// round indices — those are state, not memory. The LLM grounds the current
// turn in plain dialogue lines.
//
// "Recent" / "today" filtering happens at the call site (the prompt builder
// in prompts.ts). These helpers just render a list of interactions into text.

import type { InteractionRow, AvatarRow } from '../db/schema.js';

/**
 * Render a sequence of interactions as plain dialogue lines. Each interaction
 * yields two lines:
 *
 *   {{initiatorName}}: {{initiator_message}}
 *   {{responderName}}: {{responder_message}}
 *
 * Interactions are blank-line-separated. Returns '' when the list is empty;
 * callers substitute a context-appropriate fallback ("No prior interactions
 * yet." / "You haven't done much yet today.") in the prompt.
 *
 * @param interactions Already filtered + ordered by the caller.
 * @param avatarsById  Lookup so we can print names without an extra join.
 */
export function formatTranscript(args: {
  interactions: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): string {
  // TODO: map each interaction to two lines, '\n'-joined; join interactions
  // with '\n\n'.
  void args;
  return '';
}

/**
 * Convenience wrapper for "manager↔worker history for one specific worker"
 * — used by the manager's user prompt ("RECENT INTERACTIONS WITH {{W}}").
 * Filters the interactions list to just the ones where both participants
 * are this manager and this worker (in either direction).
 */
export function formatPairHistory(args: {
  interactions: ReadonlyArray<InteractionRow>;
  avatarA: AvatarRow;
  avatarB: AvatarRow;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): string {
  // TODO: filter interactions where {initiator, responder} == {avatarA.id, avatarB.id}
  // (unordered pair); then call formatTranscript.
  void args;
  return '';
}

/**
 * Convenience wrapper for "today so far" — interactions in the current
 * round where this avatar participated, in `order_in_round` ascending,
 * up to but not including the interaction we're about to generate. Used by
 * the worker 1:1 user prompt and both peer prompts ("YOUR DAY SO FAR:").
 */
export function formatTodaySoFar(args: {
  interactionsThisRound: ReadonlyArray<InteractionRow>;
  avatarId: string;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): string {
  // TODO: filter to interactions where avatarId is initiator or responder;
  // then call formatTranscript.
  void args;
  return '';
}
