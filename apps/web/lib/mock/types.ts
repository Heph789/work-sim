// Internal types used only by the mock backend. These are not wire shapes —
// the wire shapes come from @work-sim/shared. The mock keeps two views of
// the same data: a dashboard-shaped `RunDetail` (returned by GET /runs/:id)
// plus internal drilldown data that the per-avatar endpoint reshapes into
// AvatarDetail.

import type {
  AvatarProfile,
  DrilldownInteraction,
  DrilldownRoundEntry,
  RunDetail,
} from '@work-sim/shared';

/**
 * Per-run drilldown bookkeeping. Not part of the wire shape — the
 * /api/runs/[id]/avatars/[avatarId] route assembles AvatarDetail from this.
 */
export interface MockDrilldown {
  /**
   * All interactions across all rounds, sorted by (round_index, order_in_round).
   * The drilldown route filters this per (subject, partner).
   */
  interactions: DrilldownInteraction[];
  /**
   * Per-avatar end-of-round entries (subject view: includes private fields).
   * Keyed by avatar_id; each entry list is sorted by round_index.
   */
  roundEntries: Record<string, DrilldownRoundEntry[]>;
  /**
   * Avatar profiles keyed by id. Mirrors `run.config.avatars` augmented with
   * the run-scoped uuid; lets the drilldown route return the subject avatar's
   * full profile without re-deriving.
   */
  avatarProfiles: Record<string, AvatarProfile>;
}

/**
 * A RunDetail (dashboard shape) plus the wall-clock anchor used to advance
 * `running` runs over time, plus the drilldown bookkeeping needed to serve
 * the per-avatar endpoint. The fields prefixed `_` are stripped before the
 * RunDetail is sent over the wire.
 */
export interface MockRun extends RunDetail {
  /** Epoch ms at which this run's clock started. Used by tickIfRunning. */
  tick_started_at: number;
  /** Internal drilldown bookkeeping; not exposed via GET /runs/:id. */
  _drilldown: MockDrilldown;
}

/**
 * A scenario builder produces a list of seed runs for one named scenario.
 * Called lazily by the store on first access (and re-called per scenario
 * name; results are cached by the store).
 */
export type ScenarioBuilder = () => MockRun[];
