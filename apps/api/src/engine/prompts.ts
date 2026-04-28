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
import type { SituationTagId } from '@work-sim/shared';

/** Bumped whenever either prompt skeleton changes. Captured in config_json. */
export const PROMPT_TEMPLATE_VERSION = 'v1';

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
  // TODO: assemble {system, user} pair per the template in simulation-engine.md.
  //   const situation = getSituationTag(args.situationTag);
  //   const transcript = formatTranscript({...}) || 'No prior interactions yet.';
  //   const pace = paceDescription({...});
  //   const roundsRemaining = args.roundsTotal - args.roundsCompleted;
  //   return [
  //     { role: 'system', content: managerSystemTemplate(args.manager, args.worker) },
  //     { role: 'user',   content: managerUserTemplate({...}) },
  //   ];
  void args;
  throw new Error('buildManagerPrompt: not implemented');
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
}): Message[] {
  // TODO: assemble {system, user} pair per simulation-engine.md (Worker turn section).
  void args;
  throw new Error('buildWorkerPrompt: not implemented');
}
