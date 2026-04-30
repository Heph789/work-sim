import { describe, expect, it } from 'vitest';

import { orientPair, samplePairs } from './pair-sampling.js';

const w = (id: string) => ({ id });

describe('samplePairs', () => {
  it('returns [] when fewer than 2 workers', () => {
    expect(samplePairs([], 4, 'seed')).toEqual([]);
    expect(samplePairs([w('a')], 4, 'seed')).toEqual([]);
  });

  it('returns [] when K <= 0', () => {
    expect(samplePairs([w('a'), w('b')], 0, 'seed')).toEqual([]);
  });

  it('is deterministic for the same inputs', () => {
    const workers = ['a', 'b', 'c', 'd'].map(w);
    const a = samplePairs(workers, 4, 's');
    const b = samplePairs(workers, 4, 's');
    expect(a.map((p) => [p[0]!.id, p[1]!.id])).toEqual(
      b.map((p) => [p[0]!.id, p[1]!.id]),
    );
  });

  it('emits no self-pairs', () => {
    const workers = ['a', 'b', 'c', 'd'].map(w);
    for (const [x, y] of samplePairs(workers, 6, 'k')) {
      expect(x.id).not.toBe(y.id);
    }
  });

  it('emits no within-round duplicate when K <= unique-pair count', () => {
    // 4 workers → 6 unique pairs; K=6 must hit each exactly once.
    const workers = ['a', 'b', 'c', 'd'].map(w);
    const pairs = samplePairs(workers, 6, 'seed');
    const seen = new Set(
      pairs.map((p) => [p[0]!.id, p[1]!.id].sort().join(':')),
    );
    expect(seen.size).toBe(6);
  });

  it('fills with replacement when K > unique-pair count', () => {
    // 2 workers → 1 unique pair; K=3 → length 3 with same pair repeated.
    const workers = ['a', 'b'].map(w);
    const pairs = samplePairs(workers, 3, 'seed');
    expect(pairs).toHaveLength(3);
    for (const [x, y] of pairs) {
      expect(new Set([x.id, y.id])).toEqual(new Set(['a', 'b']));
    }
  });
});

describe('orientPair', () => {
  it('is deterministic for the same seed', () => {
    expect(orientPair('a', 'b', 's')).toEqual(orientPair('a', 'b', 's'));
  });

  it('produces both orderings across different seeds', () => {
    const orderings = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const [x, y] = orientPair('a', 'b', `seed-${i}`);
      orderings.add(`${x}:${y}`);
    }
    expect(orderings.size).toBe(2);
  });
});
