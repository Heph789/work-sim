// Prompt builders for the two LLM calls per round. Both prompts are split
// system/user with the static prefix (profile + rubric) first so providers'
// automatic prompt caching applies to the largest possible chunk.
//
// Manager prompt: free-form text completion; sees target/pace/transcript;
//   does NOT see the worker's self-perception.
// Worker prompt:  structured (WorkerResponseSchema) completion; sees the
//   manager's just-said message and the worker's own self-perception;
//   does NOT see the target_paper.

import type { Message } from '@work-sim/shared';
import type { AgentProfile, RoundView } from '@work-sim/shared';
import { getSituationTag, type SituationTagId } from '@work-sim/shared';

import { paceDescription } from './scoring.js';
import { formatTranscript } from './transcript.js';

/** Bumped whenever either prompt skeleton changes. Captured in config_json. */
export const PROMPT_TEMPLATE_VERSION = 'v2';

/** Default initial worker self-perception (round 1, when none is persisted yet). */
export const INITIAL_SELF_PERCEPTION = (managerName: string): string =>
  `I just started this job. I'm still figuring out what to expect from ${managerName} and the work.`;

/**
 * Build the manager turn's Message[]. Shape:
 *   - system: profile + rules of engagement (cacheable)
 *   - user:   today's situation + private context (target/pace/transcript)
 *
 * Per docs/initial-prototype/simulation-engine.md (Manager turn section).
 */
export function buildManagerPrompt(args: {
  manager: AgentProfile;
  worker: AgentProfile;
  /** All rounds completed so far, ordered ascending. */
  priorRounds: ReadonlyArray<Pick<RoundView, 'manager_message' | 'worker_message'>>;
  situationTag: SituationTagId;
  target: number;
  paperTotal: number;
  /** How many rounds have been written successfully so far (0-based count). */
  roundsCompleted: number;
  roundsTotal: number;
}): Message[] {
  const { manager, worker, priorRounds, situationTag, target, paperTotal, roundsCompleted, roundsTotal } = args;
  const situation = getSituationTag(situationTag);
  const transcript =
    formatTranscript({ priorRounds, managerName: manager.name, workerName: worker.name }) ||
    'No prior interactions yet.';
  const pace = paceDescription({ paperTotal, targetPaper: target, roundsCompleted, roundsTotal });
  const roundsRemaining = roundsTotal - roundsCompleted;

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
- Do NOT explicitly mention the sales target as a number unless it would be in character to do so.
- Stay in character.`;

  const user = `SITUATION TODAY: ${situation.description}

YOUR PRIVATE CONTEXT (do not mention these numbers explicitly unless natural):
- Sales target by end of period: ${target} units of paper.
- Current total sold: ${paperTotal} units.
- Rounds remaining: ${roundsRemaining}.
- Pace status: ${pace}

RECENT INTERACTIONS WITH ${worker.name.toUpperCase()}:
${transcript}

Now, what do you say to ${worker.name}?`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Build the worker turn's Message[]. Returns the messages; the LLMClient
 * caller pairs them with WorkerResponseSchema for structured output.
 *
 * The worker prompt deliberately omits target_paper — manager personality is
 * the channel through which target pressure reaches the worker.
 */
export function buildWorkerPrompt(args: {
  manager: AgentProfile;
  worker: AgentProfile;
  priorRounds: ReadonlyArray<Pick<RoundView, 'manager_message' | 'worker_message'>>;
  situationTag: SituationTagId;
  /** What the manager just said this round. */
  managerMessage: string;
  /**
   * The worker's last persisted self-perception, or null on round 1.
   * Builder substitutes INITIAL_SELF_PERCEPTION when null.
   */
  selfPerception: string | null;
  /** Last round's morale value, or null on round 1. */
  priorMorale: number | null;
}): Message[] {
  const { manager, worker, priorRounds, situationTag, managerMessage, selfPerception, priorMorale } = args;
  const situation = getSituationTag(situationTag);
  const transcript =
    formatTranscript({ priorRounds, managerName: manager.name, workerName: worker.name }) ||
    'No prior interactions yet.';
  const sp = selfPerception ?? INITIAL_SELF_PERCEPTION(manager.name);
  const moraleLine =
    priorMorale === null
      ? 'YOUR MORALE GOING IN: 50 (neutral default — you just started).'
      : `YOUR MORALE GOING IN: ${priorMorale}. This is the value to drift up or down from.`;

  const system = `You are ${worker.name}, a ${worker.role_label} at a paper company.

Your personality:
${worker.personality}

What you value at work:
${worker.values}

You report to ${manager.name}, the ${manager.role_label}.

You will respond with a JSON object containing:
- "message": Your reply to ${manager.name}, in 1–3 short sentences. Speak naturally. No narration of physical actions. Stay in character.
- "updated_self_perception": A 1–2 sentence update to your private internal monologue based on this exchange. This is your honest read of how things are going for you at work right now. ${manager.name} cannot see this.
- "morale_rationale": 1–2 sentences explaining WHY your morale moved (or didn't) this round, relative to where it was before. Reference what specifically about the exchange / situation / your own values shifted things. ${manager.name} cannot see this.
- "morale": An integer 0–100 representing your engagement and motivation right now. 50 is neutral. Below 30 means demoralized. Above 70 means energized.

Important guidance for morale:
- Treat morale as a continuous internal state — start from where you were last round and let this exchange MOVE it up or down. Do not re-anchor to a default value.
- A flat or repetitive exchange should produce a small drift in the direction your personality + values would naturally take it (e.g. if you value autonomy and the manager keeps offering unsolicited help, morale drifts down; if your values were genuinely engaged, it drifts up).
- Use the full 0–100 range over a long enough run. Sustained mismatch with your manager should reach the 20s; sustained alignment should reach the 80s. Hovering 40–60 every round is rarely the honest answer.`;

  const user = `SITUATION TODAY: ${situation.description}

YOUR CURRENT INTERNAL STATE (private):
"${sp}"

${moraleLine}

RECENT INTERACTIONS WITH ${manager.name.toUpperCase()}:
${transcript}

${manager.name} just said to you:
"${managerMessage}"

Respond now.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
