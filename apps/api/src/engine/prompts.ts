// Prompt builders for the four LLM call sites per round (per worker):
//
//   1. buildManagerPrompt        — manager 1:1, free-text completion
//   2. buildWorker1on1Prompt     — worker side of the 1:1, structured
//   3. buildPeerInitiatorPrompt  — peer initiator, structured
//   4. buildPeerResponderPrompt  — peer responder, structured
//
// All four split system/user with the static prefix (profile + rules) first
// so providers' automatic prompt caching applies to the largest possible
// chunk.
//
// The manager prompt's information asymmetry is hard-coded here per
// docs/many-workers/design.md §7: the manager prompt NEVER includes any
// worker's morale, morale_rationale, self_perception, or baseline_output.
// It DOES include team-level pace (target / paper_total / team_expected /
// team_delta) and per-worker objective output stats (cumulative paper,
// expected share, signed delta). Adding a new private state field later
// won't accidentally leak unless a developer explicitly threads it through
// `buildManagerPrompt`'s args.

import type {
  AvatarProfile,
  Message,
  SignedDelta,
} from '@work-sim/shared';
import { getSituationTag, type SituationTagId } from '@work-sim/shared';

import type { InteractionRow, AvatarRow } from '../db/schema.js';
import {
  formatPairHistory,
  formatTodaySoFar,
} from './transcript.js';

/** Bumped whenever any of the four prompt skeletons changes. */
export const PROMPT_TEMPLATE_VERSION = 'v2';

/**
 * Default initial self-perception for every worker on round 1 before they've
 * participated in any interaction. Replaced by their own emitted
 * `updated_self_perception` after the first interaction they're in.
 */
export const INITIAL_SELF_PERCEPTION =
  "I just started this job. I'm still figuring out what to expect from my manager and coworkers.";

// ─── 1. Manager 1:1 ─────────────────────────────────────────────────────────

/**
 * Build the manager turn's Message[]. Free-text completion; the model
 * produces the manager's spoken line for the 1:1 with the specified worker.
 *
 * Privacy: NONE of the worker's morale, morale_rationale, self_perception,
 * or baseline_output is in scope for this builder. The args don't even
 * accept those fields, so a future refactor cannot accidentally pass them in.
 */
export function buildManagerPrompt(args: {
  manager: AvatarProfile;
  /** The specific worker this 1:1 is with. */
  worker: AvatarProfile;
  situationTag: SituationTagId;

  /** Team-level objective context. */
  targetPaper: number;
  paperTotal: number;
  teamExpected: number;
  teamDelta: SignedDelta;
  roundsRemaining: number;

  /** Per-worker objective context (no morale, no self_perception). */
  workerPaperTotal: number;
  workerExpectedShare: number;
  workerDelta: SignedDelta;

  /**
   * Prior manager↔this-worker 1:1 interactions (any round). Excludes peer
   * interactions and 1:1s with other workers; the manager only sees their
   * own conversational history with the worker being addressed.
   */
  priorManagerWorkerInteractions: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): Message[] {
  // TODO: assemble system + user per docs/many-workers/simulation-engine.md §12.
  //
  // System (cacheable): manager profile + role of engagement.
  // User (dynamic):
  //   SITUATION TODAY: {{situation.description}}
  //   YOUR PRIVATE CONTEXT: target / team total / team_expected /
  //     team_delta / rounds_remaining.
  //   ABOUT {{worker.name.toUpperCase()}}: workerPaperTotal /
  //     workerExpectedShare / workerDelta.
  //   RECENT INTERACTIONS WITH {{worker.name.toUpperCase()}}: <pair history>
  //   Now, what do you say to {{worker.name}}?
  void args;
  void getSituationTag;
  void formatPairHistory;
  return [];
}

// ─── 2. Worker side of manager 1:1 ──────────────────────────────────────────

/**
 * Build the worker turn's Message[]. Structured completion (AvatarTurnSchema).
 * The worker sees their own self_perception, today's interactions so far
 * (any partner), full prior manager↔W history, and what the manager just said.
 */
export function buildWorker1on1Prompt(args: {
  worker: AvatarProfile;
  manager: AvatarProfile;
  situationTag: SituationTagId;
  /** Worker's running self_perception (or INITIAL_SELF_PERCEPTION on round 1). */
  selfPerception: string;
  /** What the manager just said this round; spliced into the user prompt. */
  managerMessage: string;
  /** Today's interactions where this worker was a participant (excluding the one we're building). */
  todayInteractionsForWorker: ReadonlyArray<InteractionRow>;
  /** Prior manager↔W interactions across the run (excluding current round). */
  priorManagerWorkerInteractions: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): Message[] {
  // TODO: assemble per docs/many-workers/simulation-engine.md §12.2.
  //
  // System (cacheable): worker profile + JSON-shape rules.
  // User (dynamic):
  //   SITUATION TODAY / YOUR CURRENT INTERNAL STATE / YOUR DAY SO FAR /
  //   RECENT INTERACTIONS WITH {{manager}} / "{{managerMessage}}" / Respond now.
  void args;
  void formatTodaySoFar;
  return [];
}

// ─── 3. Peer initiator ──────────────────────────────────────────────────────

/**
 * Build the peer-initiator turn's Message[]. Structured (AvatarTurnSchema).
 * The initiator opens the hallway exchange; the responder gets to see their
 * message via `buildPeerResponderPrompt`.
 */
export function buildPeerInitiatorPrompt(args: {
  self: AvatarProfile;
  partner: AvatarProfile;
  situationTag: SituationTagId;
  /** Initiator's running self_perception. */
  selfPerception: string;
  /** Today's interactions where initiator was a participant (excluding the one we're building). */
  todayInteractionsForSelf: ReadonlyArray<InteractionRow>;
  /** Prior self↔partner peer interactions across the run. */
  pairHistory: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): Message[] {
  // TODO: assemble per docs/many-workers/simulation-engine.md §12.3 + 12.4.
  //
  // System (cacheable): self profile + "you are about to have a brief
  // hallway exchange with {{partner}}" + JSON rules.
  // User (dynamic):
  //   SITUATION TODAY / YOUR CURRENT INTERNAL STATE / YOUR DAY SO FAR /
  //   PRIOR HISTORY WITH {{partner}} / "You step into the hallway and see
  //   {{partner}}. What do you say?"
  void args;
  return [];
}

// ─── 4. Peer responder ──────────────────────────────────────────────────────

/**
 * Build the peer-responder turn's Message[]. Structured (AvatarTurnSchema).
 * The responder sees the initiator's just-spoken message in addition to the
 * same context the initiator had.
 */
export function buildPeerResponderPrompt(args: {
  self: AvatarProfile;
  partner: AvatarProfile;
  situationTag: SituationTagId;
  /** Responder's running self_perception. */
  selfPerception: string;
  /** Today's interactions where responder was a participant (excluding the one we're building). */
  todayInteractionsForSelf: ReadonlyArray<InteractionRow>;
  /** Prior self↔partner peer interactions across the run. */
  pairHistory: ReadonlyArray<InteractionRow>;
  /** What the initiator just said in this exchange. */
  initiatorMessage: string;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): Message[] {
  // TODO: same shape as initiator, with system reframed "You are about to
  // RESPOND to {{partner}}…" and user prompt ending with the quoted
  // initiator message + "Respond now."
  void args;
  return [];
}
