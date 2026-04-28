// Deterministic scoring helpers consumed by the runner. The LLM never emits
// paper-sales numbers directly — it emits a subjective `morale` integer and
// the engine maps that to output via this formula. This decoupling means
// game-balance tuning is a code change in one place rather than a
// prompt-engineering exercise.
//
// Per locked-decisions.md #4.

/**
 * Map (baseline, morale) → integer paper sold this round.
 *
 *   morale=0   → output=0
 *   morale=50  → output=baseline   (neutral baseline)
 *   morale=100 → output=2*baseline (energized; double output)
 *
 * Linear, integer-rounded. No floor/ceiling beyond what 0–100 morale already
 * implies.
 */
export function paperSold(baselineOutput: number, morale: number): number {
  // TODO: return Math.round(baselineOutput * morale / 50);
  void baselineOutput;
  void morale;
  throw new Error('paperSold: not implemented');
}

/**
 * Plain-English pace summary for the manager's prompt. The LLM does the
 * dramatic interpretation; this just classifies the ratio of actual-to-expected
 * paper at the current point in the run.
 *
 * Thresholds (per simulation-engine.md):
 *   ≥ 1.15 ahead of pace
 *   ≥ 0.95 on pace
 *   ≥ 0.75 slightly behind pace
 *   <  0.75 well behind pace
 *
 * Special-cased before round 1 to avoid divide-by-zero on `expected = 0`.
 */
export function paceDescription(args: {
  paperTotal: number;
  targetPaper: number;
  roundsCompleted: number;
  roundsTotal: number;
}): string {
  // TODO:
  //   if (args.roundsCompleted === 0) return 'just starting out';
  //   const expected = (args.targetPaper * args.roundsCompleted) / args.roundsTotal;
  //   const ratio = args.paperTotal / expected;
  //   if (ratio >= 1.15) return 'ahead of pace';
  //   if (ratio >= 0.95) return 'on pace';
  //   if (ratio >= 0.75) return 'slightly behind pace';
  //   return 'well behind pace';
  void args;
  throw new Error('paceDescription: not implemented');
}
