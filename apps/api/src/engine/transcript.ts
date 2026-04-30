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
 * callers substitute a context-appropriate fallback.
 */
export function formatTranscript(args: {
  interactions: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): string {
  const { interactions, avatarsById } = args;
  if (interactions.length === 0) return '';
  return interactions
    .map((it) => {
      const initiator = avatarsById.get(it.initiatorAvatarId);
      const responder = avatarsById.get(it.responderAvatarId);
      const initiatorName = initiator?.name ?? 'Unknown';
      const responderName = responder?.name ?? 'Unknown';
      return `${initiatorName}: ${it.initiatorMessage}\n${responderName}: ${it.responderMessage}`;
    })
    .join('\n\n');
}

/**
 * Convenience wrapper for "history between two specific avatars" — used by
 * the manager's user prompt ("RECENT INTERACTIONS WITH {{W}}") and peer
 * prompts ("PRIOR HISTORY WITH {{partner}}"). Filters the interactions list
 * to ones where both participants match the unordered pair {avatarA, avatarB}.
 */
export function formatPairHistory(args: {
  interactions: ReadonlyArray<InteractionRow>;
  avatarA: AvatarRow;
  avatarB: AvatarRow;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): string {
  const { interactions, avatarA, avatarB, avatarsById } = args;
  const filtered = interactions.filter((it) => {
    const ids = new Set([it.initiatorAvatarId, it.responderAvatarId]);
    return ids.has(avatarA.id) && ids.has(avatarB.id);
  });
  return formatTranscript({ interactions: filtered, avatarsById });
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
  const { interactionsThisRound, avatarId, avatarsById } = args;
  const filtered = interactionsThisRound.filter(
    (it) =>
      it.initiatorAvatarId === avatarId || it.responderAvatarId === avatarId,
  );
  return formatTranscript({ interactions: filtered, avatarsById });
}
