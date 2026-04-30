// Scenario: completed-miss. Run finished with paper_total < target_paper.
// Ensures the red "Missed target" banner renders.

import { buildRun } from '../build-run.js';
import type { ScenarioBuilder } from '../types.js';
import { TOBY, STANLEY, PHYLLIS } from './_profiles.js';

export const completedMiss: ScenarioBuilder = () => {
  const run = buildRun({
    scenario: 'completed-miss',
    manager: TOBY,
    workers: [STANLEY, PHYLLIS],
    status: 'completed',
    rounds_total: 8,
    rounds_completed: 8,
    target_paper: 600, // intentionally too high to hit
    created_at: Date.now() - 8 * 60_000,
  });
  // Force the miss in case the random walk over-performed.
  if (run.paper_total >= run.target_paper) {
    run.paper_total = run.target_paper - 30;
  }
  return [run];
};
