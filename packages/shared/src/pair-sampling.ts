// Deterministic peer-pair sampling for the per-round peer phase.
//
// Properties (per docs/many-workers/design.md §4 and simulation-engine.md):
//  - Same (workers, K, seed) inputs → same pair sequence (reproducibility).
//  - No self-pairs.
//  - No within-round duplicate unordered pair, UNLESS the unique-pair space
//    is smaller than K (e.g. N=2 → only one unique pair, K=2 allows it twice).
//  - N=1 → returns []; the peer phase becomes a no-op.
//  - `orientPair` chooses initiator vs responder via a deterministic coin
//    seeded separately so pair-membership and orientation don't entangle.
//
// Uses the same self-contained mulberry32 + string-hash as situation-tags.ts
// — no extra dependencies. (The deep-dive doc shows seedrandom in pseudocode;
// we don't need its full algorithm space.)

/**
 * Minimal shape the sampler needs from each worker. Real callers pass full
 * Avatar rows; this loose shape keeps the function pure and easy to unit-test.
 */
export interface PairCandidate {
  id: string;
}

/**
 * Sample K peer pairs from `workers`. Returns a length-K array of [a, b]
 * tuples in the deterministic sample order. Caller is responsible for
 * passing them through `orientPair` to assign initiator/responder.
 *
 * Strategy:
 *   1. Enumerate all unique unordered pairs (i<j). If empty (N<2), return [].
 *   2. Sample without replacement from that list until we hit K or exhaust it.
 *   3. If still short of K (i.e. K > unique-pair count), fill the remainder
 *      *with replacement* from the full unique-pair list.
 */
export function samplePairs<T extends PairCandidate>(
  workers: readonly T[],
  K: number,
  seed: string,
): Array<[T, T]> {
  // TODO: implement per the strategy above using mulberry32(hashString(seed)).
  // Empty cases:
  //   if (workers.length < 2) return [];
  //   if (K <= 0) return [];
  void workers;
  void K;
  void seed;
  return [];
}

/**
 * Decide which of (a, b) speaks first. Seeded coin flip — independent from
 * the sampling RNG so re-ordering pair-sample-order doesn't shift orientation.
 */
export function orientPair<T>(
  a: T,
  b: T,
  seed: string,
): [T, T] {
  // TODO: const rng = mulberry32(hashString(seed)); return rng() < 0.5 ? [a, b] : [b, a];
  void seed;
  return [a, b];
}
