// The fixed list of per-round contextual situations and the deterministic
// picker that selects one given (seed, round_index). Without a per-round
// pretext, conversations devolve into "how are you doing?" / "fine"; the tag
// gives the manager prompt a concrete day-context to react to.
//
// Selection is seeded so that two runs with the same situation_tag_seed pick
// the same sequence of tags, which is necessary for experiment replicates.
// See docs/initial-prototype/simulation-engine.md.

/**
 * One entry in the static situation list. `weight` controls relative
 * frequency in the weighted-random pick; descriptions are inlined into the
 * manager prompt as the day's context.
 */
export interface SituationTag {
  /** Stable id; persisted in `rounds.situation_tag`. */
  tag: string;
  /** Relative weight; sum across the list = 100% probability. */
  weight: number;
  /** Plain-English description spliced into the manager prompt. */
  description: string;
}

/**
 * Static list. `as const` so callers see a tuple of literal tag strings. To
 * add a new tag, append here — no DB migration; the seed-based picker just
 * works with the new total weight.
 */
export const SITUATION_TAGS = [
  {
    tag: 'routine_check_in',
    weight: 4,
    description: 'A normal day. The manager is doing a routine 1:1.',
  },
  {
    tag: 'missed_target',
    weight: 2,
    description: 'The team missed an important sales number this week.',
  },
  {
    tag: 'big_client_won',
    weight: 1,
    description: 'A large new client just signed; energy in the office is high.',
  },
  {
    tag: 'tight_deadline',
    weight: 2,
    description: 'There is a delivery deadline at the end of the day with little slack.',
  },
  {
    tag: 'peer_conflict',
    weight: 1,
    description: 'There is friction between the worker and another teammate.',
  },
  {
    tag: 'quiet_week',
    weight: 2,
    description: 'It has been an unusually slow week with little going on.',
  },
  {
    tag: 'customer_complaint',
    weight: 1,
    description: 'A customer escalated a complaint that the worker handled.',
  },
  {
    tag: 'recognition_opportunity',
    weight: 1,
    description: 'The worker did something noticeable that could be acknowledged.',
  },
] as const satisfies readonly SituationTag[];

/** Convenience: union of all tag string literals. */
export type SituationTagId = (typeof SITUATION_TAGS)[number]['tag'];

/**
 * Deterministically pick a tag for a given (seed, roundIndex). Same inputs
 * always produce the same output — necessary for reproducible replicates.
 *
 * Implementation: weighted random where the RNG is seeded with `seed:roundIndex`.
 *
 * @param seed       The run's situation_tag_seed (captured in config_json).
 * @param roundIndex 1-based round number.
 *
 * DEPENDENCY: seedrandom — needs adding to apps/api/package.json (or here).
 */
export function pickTag(seed: number, roundIndex: number): SituationTagId {
  const rng = mulberry32(hashString(`${seed}:${roundIndex}`));
  const total = SITUATION_TAGS.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of SITUATION_TAGS) {
    r -= t.weight;
    if (r <= 0) return t.tag;
  }
  return SITUATION_TAGS[SITUATION_TAGS.length - 1]!.tag;
}

/** Lookup helper: tag id → SituationTag (for inlining the description into prompts). */
export function getSituationTag(id: SituationTagId): SituationTag {
  const found = SITUATION_TAGS.find((t) => t.tag === id);
  if (!found) throw new Error(`unknown situation tag: ${id}`);
  return found;
}

// Tiny self-contained PRNG so the shared package has zero runtime deps. The
// runner's reproducibility guarantee just needs determinism — not crypto-grade
// uniformity. mulberry32 + a string hash gets us that without pulling in
// seedrandom.
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
