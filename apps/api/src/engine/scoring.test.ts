import { describe, expect, it } from 'vitest';

import {
  applyMoraleDelta,
  MANAGER_DELTA_WEIGHT,
  paperSold,
  signedDelta,
  teamExpected,
  workerExpectedShare,
} from './scoring.js';

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

describe('teamExpected', () => {
  it('is zero before any rounds complete', () => {
    expect(
      teamExpected({ targetPaper: 100, roundsCompleted: 0, roundsTotal: 10 }),
    ).toBe(0);
  });

  it('is full target at completion', () => {
    expect(
      teamExpected({ targetPaper: 100, roundsCompleted: 10, roundsTotal: 10 }),
    ).toBe(100);
  });

  it('rounds half-rate to nearest integer', () => {
    expect(
      teamExpected({ targetPaper: 100, roundsCompleted: 3, roundsTotal: 7 }),
    ).toBe(43);
  });
});

describe('workerExpectedShare', () => {
  it('splits target evenly across workers', () => {
    expect(
      workerExpectedShare({
        targetPaper: 100,
        numWorkers: 4,
        roundsCompleted: 10,
        roundsTotal: 10,
      }),
    ).toBe(25);
  });

  it('scales by completed rounds', () => {
    expect(
      workerExpectedShare({
        targetPaper: 100,
        numWorkers: 4,
        roundsCompleted: 5,
        roundsTotal: 10,
      }),
    ).toBe(13);
  });
});

describe('signedDelta', () => {
  it('is "above" when actual exceeds expected', () => {
    expect(signedDelta(60, 50)).toEqual({ abs: 10, direction: 'above' });
  });

  it('is "below" when actual is under expected', () => {
    expect(signedDelta(40, 50)).toEqual({ abs: 10, direction: 'below' });
  });

  it('treats equality as "above"', () => {
    expect(signedDelta(50, 50)).toEqual({ abs: 0, direction: 'above' });
  });
});

describe('applyMoraleDelta', () => {
  it('applies a peer-weight delta unchanged', () => {
    expect(applyMoraleDelta(50, +5, 1)).toBe(55);
    expect(applyMoraleDelta(50, -3, 1)).toBe(47);
  });

  it('scales the delta by the manager weight', () => {
    expect(applyMoraleDelta(50, +5, MANAGER_DELTA_WEIGHT)).toBe(60);
    expect(applyMoraleDelta(50, -5, MANAGER_DELTA_WEIGHT)).toBe(40);
  });

  it('clamps the running total at 100', () => {
    expect(applyMoraleDelta(95, +10, 1)).toBe(100);
    expect(applyMoraleDelta(95, +10, MANAGER_DELTA_WEIGHT)).toBe(100);
  });

  it('clamps the running total at 0', () => {
    expect(applyMoraleDelta(5, -10, 1)).toBe(0);
    expect(applyMoraleDelta(5, -10, MANAGER_DELTA_WEIGHT)).toBe(0);
  });

  it('treats a 0 delta as a no-op', () => {
    expect(applyMoraleDelta(60, 0, MANAGER_DELTA_WEIGHT)).toBe(60);
  });
});

describe('MANAGER_DELTA_WEIGHT', () => {
  it('is 2 — manager 1:1 morale shifts twice as hard as a peer chat', () => {
    expect(MANAGER_DELTA_WEIGHT).toBe(2);
  });
});
