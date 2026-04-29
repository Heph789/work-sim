// Scenario registry. Each scenario is a `() => MockRun[]` function — called
// lazily by the store on first access for a scenario, then cached.
//
// The 'default' scenario is the union of every non-empty built-in. A fresh
// dev visit lands on 'default', which gives ~5 runs covering every status.

import type { MockRun, ScenarioBuilder } from '../types.js';
import { empty } from './empty.js';
import { running1w } from './running-1w.js';
import { running4w } from './running-4w.js';
import { completedHit } from './completed-hit.js';
import { completedMiss } from './completed-miss.js';
import { failed } from './failed.js';

const NAMED: Record<string, ScenarioBuilder> = {
  empty,
  'running-1w': running1w,
  'running-4w': running4w,
  'completed-hit': completedHit,
  'completed-miss': completedMiss,
  failed,
};

const defaultScenario: ScenarioBuilder = () => {
  // Concatenate every scenario except 'empty'. Order shows running runs first
  // so the dashboard has motion to demo immediately.
  const all: MockRun[] = [];
  for (const [name, build] of Object.entries(NAMED)) {
    if (name === 'empty') continue;
    all.push(...build());
  }
  // Newest-first by created_at — matches the real API's sort.
  all.sort((a, b) => b.created_at - a.created_at);
  return all;
};

export const SCENARIOS: Record<string, ScenarioBuilder> = {
  ...NAMED,
  default: defaultScenario,
};

/** Display-friendly names for the dev picker. Order is the dropdown order. */
export const SCENARIO_NAMES = [
  'default',
  'empty',
  'running-1w',
  'running-4w',
  'completed-hit',
  'completed-miss',
  'failed',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];
