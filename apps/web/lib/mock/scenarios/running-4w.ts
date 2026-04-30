// Scenario: running-4w. One manager + four workers, mid-progress.

import { buildRun } from '../build-run.js';
import type { ScenarioBuilder } from '../types.js';
import { JAN, JIM, PAM, DWIGHT, ANDY } from './_profiles.js';

export const running4w: ScenarioBuilder = () => [
  buildRun({
    scenario: 'running-4w',
    manager: JAN,
    workers: [JIM, PAM, DWIGHT, ANDY],
    status: 'running',
    rounds_total: 10,
    rounds_completed: 4,
    target_paper: 500,
    created_at: Date.now() - 45_000,
    tick_started_at: Date.now() - 16_000,
  }),
];
