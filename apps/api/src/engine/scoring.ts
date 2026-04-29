// Deterministic scoring helpers consumed by the runner and by the dashboard
// response shaper. The LLM never emits paper-sales numbers directly — it
// emits a subjective `morale` integer and the engine maps that to output via
// these formulas. This decoupling keeps balance tuning a code change in one
// place.
//
// The prototype's `paceDescription` is gone — the manager prompt now uses
// raw signed deltas (driven by `signedDelta` here), not a categorical phrase.

import type { SignedDelta } from '@work-sim/shared';

/**
 * Map (baseline, morale) → integer paper sold this round.
 *
 *   morale=0   → output=0
 *   morale=50  → output=baseline   (neutral baseline)
 *   morale=100 → output=2*baseline (energized; double output)
 *
 * Linear, integer-rounded.
 */
export function paperSold(baselineOutput: number, morale: number): number {
  return Math.round((baselineOutput * morale) / 50);
}

/**
 * What the team SHOULD have produced by `roundsCompleted` if pace were even:
 * `round(target_paper * roundsCompleted / roundsTotal)`. Injected into the
 * manager prompt and used by the dashboard's team_delta tile.
 */
export function teamExpected(args: {
  targetPaper: number;
  roundsCompleted: number;
  roundsTotal: number;
}): number {
  if (args.roundsTotal <= 0) return 0;
  return Math.round((args.targetPaper * args.roundsCompleted) / args.roundsTotal);
}

/**
 * What a single worker SHOULD have produced by `roundsCompleted` if their
 * share of the team target were even and the run were on pace:
 * `round((target_paper / num_workers) * (roundsCompleted / roundsTotal))`.
 *
 * Injected into the manager prompt under "ABOUT {{worker}}" so the manager
 * can react to per-worker pace without seeing morale.
 */
export function workerExpectedShare(args: {
  targetPaper: number;
  numWorkers: number;
  roundsCompleted: number;
  roundsTotal: number;
}): number {
  if (args.numWorkers <= 0 || args.roundsTotal <= 0) return 0;
  return Math.round(
    (args.targetPaper / args.numWorkers) *
      (args.roundsCompleted / args.roundsTotal),
  );
}

/**
 * Render `actual - expected` as an absolute magnitude + direction. Used by
 * both the manager prompt ("Team is {{abs}} units {{above|below}} expected")
 * and the dashboard ({ team_delta, worker_delta }).
 */
export function signedDelta(actual: number, expected: number): SignedDelta {
  const d = actual - expected;
  return { abs: Math.abs(d), direction: d >= 0 ? 'above' : 'below' };
}
