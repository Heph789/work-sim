// Scenario: running-1w. One manager + one worker, mid-progress, status=running.
// The store's tick advances rounds_completed → rounds_total over time.

import { buildRun } from '../build-run.js';
import type { ScenarioBuilder } from '../types.js';
import { MICHAEL, JIM } from './_profiles.js';

export const running1w: ScenarioBuilder = () => [
  buildRun({
    scenario: 'running-1w',
    manager: MICHAEL,
    workers: [JIM],
    status: 'running',
    rounds_total: 8,
    rounds_completed: 3,
    target_paper: 90,
    created_at: Date.now() - 30_000,
    tick_started_at: Date.now() - 12_000, // 3 rounds in already (4s/round)
  }),
];
