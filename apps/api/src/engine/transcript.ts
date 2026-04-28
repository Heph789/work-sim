// Transcript formatter. Past rounds are concatenated as plain dialogue —
// no situation tags, no morale numbers, no round indices (those are state,
// not memory). Both the manager and worker prompts get the same transcript
// so the model can ground its current turn in the history.
//
// When transcript size becomes a problem (probably never with 2 agents over
// tens of rounds), summarize older rounds. For v1, include everything.

import type { RoundView } from '@work-sim/shared';

/**
 * Render `priorRounds` as alternating manager/worker lines, blank-line
 * separated by round. If the list is empty, callers should substitute
 * "No prior interactions yet." in the prompt — this function returns ''.
 *
 * Output shape:
 *   {{managerName}}: {{manager_message}}
 *   {{workerName}}: {{worker_message}}
 *
 *   {{managerName}}: ...
 *   ...
 */
export function formatTranscript(args: {
  priorRounds: ReadonlyArray<Pick<RoundView, 'manager_message' | 'worker_message'>>;
  managerName: string;
  workerName: string;
}): string {
  return args.priorRounds
    .map(
      (r) =>
        `${args.managerName}: ${r.manager_message}\n${args.workerName}: ${r.worker_message}`,
    )
    .join('\n\n');
}
