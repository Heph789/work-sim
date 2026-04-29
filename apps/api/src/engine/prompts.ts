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
  formatTranscript,
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

const NO_PRIOR_INTERACTIONS = 'No prior interactions yet.';
const NO_DAY_SO_FAR = "You haven't done much yet today.";
const NO_PAIR_HISTORY = "You haven't spoken with them before in this run.";

function profileToRowLike(p: AvatarProfile): AvatarRow {
  return {
    id: p.id,
    runId: '',
    roleInSim: p.role_in_sim,
    name: p.name,
    roleLabel: p.role_label,
    personality: p.personality,
    values: p.values,
    baselineOutput: p.baseline_output,
  };
}

// ─── 1. Manager 1:1 ─────────────────────────────────────────────────────────

export function buildManagerPrompt(args: {
  manager: AvatarProfile;
  worker: AvatarProfile;
  situationTag: SituationTagId;

  targetPaper: number;
  paperTotal: number;
  teamExpected: number;
  teamDelta: SignedDelta;
  roundsRemaining: number;

  workerPaperTotal: number;
  workerExpectedShare: number;
  workerDelta: SignedDelta;

  priorManagerWorkerInteractions: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): Message[] {
  const { manager, worker } = args;
  const situation = getSituationTag(args.situationTag);

  const system = `You are ${manager.name}, the ${manager.role_label} at a paper company.

Your personality:
${manager.personality}

What you value at work:
${manager.values}

You are speaking with your direct report, ${worker.name}, who works as a ${worker.role_label}.

Rules of engagement:
- Speak naturally, in 1–3 short sentences.
- Do NOT narrate your own actions ("I lean back in my chair…"). Just say what you say.
- Do NOT reference round numbers, simulations, or any meta-commentary.
- Do NOT explicitly mention numerical sales targets unless it would be in character to do so.
- Stay in character.`;

  const transcript = formatPairHistory({
    interactions: args.priorManagerWorkerInteractions,
    avatarA: profileToRowLike(manager),
    avatarB: profileToRowLike(worker),
    avatarsById: args.avatarsById,
  });

  const workerNameUpper = worker.name.toUpperCase();

  const user = `SITUATION TODAY: ${situation.description}

YOUR PRIVATE CONTEXT:
- Sales target by end of period: ${args.targetPaper} units total.
- Team total sold: ${args.paperTotal} units.
- Expected team total by now: ${args.teamExpected} units.
- Team is ${args.teamDelta.abs} units ${args.teamDelta.direction} expected.
- Rounds remaining: ${args.roundsRemaining}.

ABOUT ${workerNameUpper}:
- Their cumulative output this run: ${args.workerPaperTotal} units.
- Their expected share by now: ${args.workerExpectedShare} units.
    ( = target_paper / num_workers × rounds_completed / rounds_total )
- They are ${args.workerDelta.abs} units ${args.workerDelta.direction} their expected share.

RECENT INTERACTIONS WITH ${workerNameUpper}:
${transcript || NO_PRIOR_INTERACTIONS}

Now, what do you say to ${worker.name}?`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─── 2. Worker side of manager 1:1 ──────────────────────────────────────────

export function buildWorker1on1Prompt(args: {
  worker: AvatarProfile;
  manager: AvatarProfile;
  situationTag: SituationTagId;
  selfPerception: string;
  managerMessage: string;
  todayInteractionsForWorker: ReadonlyArray<InteractionRow>;
  priorManagerWorkerInteractions: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): Message[] {
  const { worker, manager } = args;
  const situation = getSituationTag(args.situationTag);

  const system = `You are ${worker.name}, a ${worker.role_label} at a paper company.

Your personality:
${worker.personality}

What you value at work:
${worker.values}

You report to ${manager.name}, the ${manager.role_label}. You also work alongside other employees on your team.

You will respond with a JSON object containing:
- "message": Your reply to ${manager.name}, in 1–3 short sentences. Speak naturally. No narration of physical actions. Stay in character.
- "updated_self_perception": A 1–2 sentence update to your private internal monologue based on this exchange. Mention specific people by name where relevant. ${manager.name} cannot see this.
- "morale": An integer 0–100 representing your engagement and motivation right now. 50 is neutral. Below 30 means demoralized. Above 70 means energized.
- "morale_rationale": One short sentence explaining why this morale, given the day.`;

  const todaySoFar = formatTodaySoFar({
    interactionsThisRound: args.todayInteractionsForWorker,
    avatarId: worker.id,
    avatarsById: args.avatarsById,
  });

  const managerHistory = formatTranscript({
    interactions: args.priorManagerWorkerInteractions,
    avatarsById: args.avatarsById,
  });

  const managerNameUpper = manager.name.toUpperCase();

  const user = `SITUATION TODAY: ${situation.description}

YOUR CURRENT INTERNAL STATE (private):
"${args.selfPerception}"

YOUR DAY SO FAR:
${todaySoFar || NO_DAY_SO_FAR}

RECENT INTERACTIONS WITH ${managerNameUpper} (across this run):
${managerHistory || NO_PRIOR_INTERACTIONS}

${manager.name} just said to you:
"${args.managerMessage}"

Respond now.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─── 3. Peer initiator ──────────────────────────────────────────────────────

export function buildPeerInitiatorPrompt(args: {
  self: AvatarProfile;
  partner: AvatarProfile;
  situationTag: SituationTagId;
  selfPerception: string;
  todayInteractionsForSelf: ReadonlyArray<InteractionRow>;
  pairHistory: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): Message[] {
  return buildPeerSystemAndUser({
    ...args,
    framing: 'initiator',
    initiatorMessage: null,
  });
}

// ─── 4. Peer responder ──────────────────────────────────────────────────────

export function buildPeerResponderPrompt(args: {
  self: AvatarProfile;
  partner: AvatarProfile;
  situationTag: SituationTagId;
  selfPerception: string;
  todayInteractionsForSelf: ReadonlyArray<InteractionRow>;
  pairHistory: ReadonlyArray<InteractionRow>;
  initiatorMessage: string;
  avatarsById: ReadonlyMap<string, AvatarRow>;
}): Message[] {
  return buildPeerSystemAndUser({
    ...args,
    framing: 'responder',
  });
}

function buildPeerSystemAndUser(args: {
  self: AvatarProfile;
  partner: AvatarProfile;
  situationTag: SituationTagId;
  selfPerception: string;
  todayInteractionsForSelf: ReadonlyArray<InteractionRow>;
  pairHistory: ReadonlyArray<InteractionRow>;
  avatarsById: ReadonlyMap<string, AvatarRow>;
  framing: 'initiator' | 'responder';
  initiatorMessage?: string | null;
}): Message[] {
  const { self, partner, framing } = args;
  const situation = getSituationTag(args.situationTag);

  const engagement =
    framing === 'initiator'
      ? `You work alongside several other employees. You are about to have a brief hallway/break-room exchange with your coworker ${partner.name}, who works as a ${partner.role_label}.`
      : `You work alongside several other employees. You are about to RESPOND to your coworker ${partner.name}, who works as a ${partner.role_label} and just spoke to you in the hallway.`;

  const system = `You are ${self.name}, a ${self.role_label} at a paper company.

Your personality:
${self.personality}

What you value at work:
${self.values}

${engagement}

You will respond with a JSON object containing:
- "message": What you say to ${partner.name}, in 1–3 short sentences. Speak naturally. No narration of physical actions. Stay in character.
- "updated_self_perception": A 1–2 sentence update to your private internal monologue based on this exchange. Mention specific people by name where relevant. ${partner.name} cannot see this.
- "morale": An integer 0–100 representing your engagement and motivation right now. 50 is neutral. Below 30 means demoralized. Above 70 means energized.
- "morale_rationale": One short sentence explaining why this morale, given the day.`;

  const todaySoFar = formatTodaySoFar({
    interactionsThisRound: args.todayInteractionsForSelf,
    avatarId: self.id,
    avatarsById: args.avatarsById,
  });

  const pairHistoryText = formatPairHistory({
    interactions: args.pairHistory,
    avatarA: profileToRowLike(self),
    avatarB: profileToRowLike(partner),
    avatarsById: args.avatarsById,
  });

  const partnerNameUpper = partner.name.toUpperCase();

  const closing =
    framing === 'initiator'
      ? `You step into the hallway and see ${partner.name}. What do you say?`
      : `${partner.name} just said to you:
"${args.initiatorMessage ?? ''}"

Respond now.`;

  const user = `SITUATION TODAY: ${situation.description}

YOUR CURRENT INTERNAL STATE (private):
"${args.selfPerception}"

YOUR DAY SO FAR:
${todaySoFar || NO_DAY_SO_FAR}

PRIOR HISTORY WITH ${partnerNameUpper} (across this run):
${pairHistoryText || NO_PAIR_HISTORY}

${closing}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
