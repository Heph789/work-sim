import { describe, expect, it } from 'vitest';

import {
  SITUATION_TAGS,
  getSituationTag,
  pickTag,
} from './situation-tags.js';

describe('pickTag', () => {
  it('is deterministic for the same (seed, roundIndex)', () => {
    const a = pickTag(42, 1);
    const b = pickTag(42, 1);
    expect(a).toBe(b);
  });

  it('produces a valid tag from the static list', () => {
    const validTags = new Set(SITUATION_TAGS.map((t) => t.tag));
    for (let i = 1; i <= 50; i++) {
      expect(validTags.has(pickTag(123, i))).toBe(true);
    }
  });

  it('different seeds produce different tag sequences', () => {
    const seqA = Array.from({ length: 20 }, (_, i) => pickTag(1, i + 1));
    const seqB = Array.from({ length: 20 }, (_, i) => pickTag(2, i + 1));
    expect(seqA).not.toEqual(seqB);
  });
});

describe('getSituationTag', () => {
  it('returns the matching entry', () => {
    expect(getSituationTag('routine_check_in').tag).toBe('routine_check_in');
  });
});
