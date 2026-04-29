// Scenario: failed. Run aborted mid-flight; failed_at_round + error_message
// populated. Exercises the failure banner on the dashboard.

import { buildRun } from '../build-run.js';
import type { ScenarioBuilder } from '../types.js';
import { JAN, ANDY, PAM } from './_profiles.js';

export const failed: ScenarioBuilder = () => [
  buildRun({
    scenario: 'failed',
    manager: JAN,
    workers: [ANDY, PAM],
    status: 'failed',
    rounds_total: 8,
    rounds_completed: 3,
    target_paper: 240,
    created_at: Date.now() - 12 * 60_000,
    failed_at_round: 4,
    error_message:
      'LLM provider returned 503 after 3 retries. Aborting run; resume not supported in v1.',
  }),
];
