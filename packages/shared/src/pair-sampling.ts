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
 */
export function samplePairs<T extends PairCandidate>(
  workers: readonly T[],
  K: number,
  seed: string,
): Array<[T, T]> {
  if (workers.length < 2) return [];
  if (K <= 0) return [];

  const rng = mulberry32(hashString(seed));

  const allPairs: Array<[T, T]> = [];
  for (let i = 0; i < workers.length; i++) {
    for (let j = i + 1; j < workers.length; j++) {
      allPairs.push([workers[i]!, workers[j]!]);
    }
  }

  const result: Array<[T, T]> = [];
  const remaining = [...allPairs];
  while (result.length < K && remaining.length > 0) {
    const idx = Math.floor(rng() * remaining.length);
    result.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  while (result.length < K) {
    const idx = Math.floor(rng() * allPairs.length);
    result.push(allPairs[idx]!);
  }
  return result;
}

/**
 * Decide which of (a, b) speaks first. Seeded coin flip — independent from
 * the sampling RNG so re-ordering pair-sample-order doesn't shift orientation.
 */
export function orientPair<T>(a: T, b: T, seed: string): [T, T] {
  const rng = mulberry32(hashString(seed));
  return rng() < 0.5 ? [a, b] : [b, a];
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
