// Internal types used only by the mock backend. These are not wire shapes —
// the wire shapes come from @work-sim/shared. The "seed" type extends a
// RunDetail with a `tick_started_at` so the store can advance running runs
// based on wall-clock time.

import type { RunDetail } from '@work-sim/shared';

/**
 * A RunDetail plus internal bookkeeping the mock store uses to advance
 * `running` runs over time. The wall-clock anchor lets `tickIfRunning`
 * compute how many rounds *should* be completed by now and fabricate the
 * missing per-round data.
 */
export interface MockRun extends RunDetail {
  /** Epoch ms at which this run's clock started. Used by tickIfRunning. */
  tick_started_at: number;
}

/**
 * A scenario builder produces a list of seed runs for one named scenario.
 * Called lazily by the store on first access (and re-called per scenario
 * name; results are cached by the store).
 */
export type ScenarioBuilder = () => MockRun[];
