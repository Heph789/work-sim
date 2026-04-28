import { describe, expect, it } from 'vitest';

import { paceDescription, paperSold } from './scoring.js';

describe('paperSold', () => {
  it('is zero at morale 0', () => {
    expect(paperSold(10, 0)).toBe(0);
  });

  it('equals baseline at morale 50', () => {
    expect(paperSold(10, 50)).toBe(10);
  });

  it('doubles baseline at morale 100', () => {
    expect(paperSold(10, 100)).toBe(20);
  });

  it('scales linearly between extremes', () => {
    expect(paperSold(10, 25)).toBe(5);
    expect(paperSold(10, 75)).toBe(15);
  });

  it('rounds to integer', () => {
    // 14 * 33 / 50 = 9.24 → 9
    expect(paperSold(14, 33)).toBe(9);
  });
});

describe('paceDescription', () => {
  const base = { targetPaper: 100, roundsTotal: 10 };

  it('returns "just starting out" before any rounds complete', () => {
    expect(
      paceDescription({ ...base, paperTotal: 0, roundsCompleted: 0 }),
    ).toBe('just starting out');
  });

  it('classifies "ahead of pace" at ratio ≥ 1.15', () => {
    // expected = 100 * 5 / 10 = 50; paperTotal=60 → ratio 1.2
    expect(
      paceDescription({ ...base, paperTotal: 60, roundsCompleted: 5 }),
    ).toBe('ahead of pace');
  });

  it('classifies "on pace" at ratio ≥ 0.95', () => {
    expect(
      paceDescription({ ...base, paperTotal: 50, roundsCompleted: 5 }),
    ).toBe('on pace');
  });

  it('classifies "slightly behind pace" at ratio ≥ 0.75', () => {
    expect(
      paceDescription({ ...base, paperTotal: 40, roundsCompleted: 5 }),
    ).toBe('slightly behind pace');
  });

  it('classifies "well behind pace" at ratio < 0.75', () => {
    expect(
      paceDescription({ ...base, paperTotal: 10, roundsCompleted: 5 }),
    ).toBe('well behind pace');
  });
});
