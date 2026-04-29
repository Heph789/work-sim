// Scenario: completed-hit. Run finished with paper_total >= target_paper.
// Ensures the green "Hit target" banner renders.

import { buildRun } from '../build-run.js';
import type { ScenarioBuilder } from '../types.js';
import { DAVID, JIM, DWIGHT } from './_profiles.js';

export const completedHit: ScenarioBuilder = () => {
  const run = buildRun({
    scenario: 'completed-hit',
    manager: DAVID,
    workers: [JIM, DWIGHT],
    status: 'completed',
    rounds_total: 8,
    rounds_completed: 8,
    target_paper: 200,
    created_at: Date.now() - 5 * 60_000,
  });
  // Force the hit by topping up paper_total if the random walk fell short.
  if (run.paper_total < run.target_paper) {
    run.paper_total = run.target_paper + 10;
  }
  return [run];
};
