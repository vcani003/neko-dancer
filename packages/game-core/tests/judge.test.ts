/**
 * `judge` — ADR-005, and the boundary table Part 4 makes mandatory.
 *
 * These are the most tuning-sensitive numbers in the project and the ones most
 * likely to be quietly wrong. Every boundary is walked on BOTH sides, and every
 * grade is checked early and late, because a comparison written `<` instead of
 * `<=` moves exactly one millisecond and no playtest would ever find it.
 */
import { describe, expect, it } from 'vitest';
import { judge } from '@neko/game-core';
import { DEFAULT_WINDOWS, JUDGMENTS, type JudgmentWindows } from '@neko/protocol';

describe('every boundary lands on the tier it names — ADR-005', () => {
  /**
   * "Boundaries are inclusive of the tier they name — 35 is PERFECT, 36 is
   * GREAT." Windows are 35 / 70 / 110 / 160, and MISS is what falls outside
   * `okayMs` rather than a window of its own.
   */
  it.each([
    [0, 'PERFECT'],
    [1, 'PERFECT'],
    [34, 'PERFECT'],
    [35, 'PERFECT'],
    [36, 'GREAT'],
    [37, 'GREAT'],
    [69, 'GREAT'],
    [70, 'GREAT'],
    [71, 'GOOD'],
    [72, 'GOOD'],
    [109, 'GOOD'],
    [110, 'GOOD'],
    [111, 'OKAY'],
    [112, 'OKAY'],
    [159, 'OKAY'],
    [160, 'OKAY'],
    [161, 'MISS'],
    [162, 'MISS'],
    [250, 'MISS'],
    [10_000, 'MISS'],
  ])('|delta| of %i ms is %s', (absDeltaMs, expected) => {
    expect(judge(absDeltaMs, DEFAULT_WINDOWS)).toBe(expected);
  });

  it('never returns a grade outside the five ADR-005 declares', () => {
    for (let delta = 0; delta <= 400; delta++) {
      expect(JUDGMENTS).toContain(judge(delta, DEFAULT_WINDOWS));
    }
  });

  it('never improves as the error grows', () => {
    // Monotonicity: a later press can never earn a better grade than an
    // earlier one. An off-by-one in the ladder shows up here as a reversal.
    let previousRank = 0;
    for (let delta = 0; delta <= 400; delta++) {
      const rank = JUDGMENTS.indexOf(judge(delta, DEFAULT_WINDOWS));
      expect(rank).toBeGreaterThanOrEqual(previousRank);
      previousRank = rank;
    }
  });
});

describe('the windows are a parameter, not a constant', () => {
  // §12 calls the values provisional. An implementation that ignored its
  // `windows` argument would pass every test above and fail every retune.
  const tight: JudgmentWindows = { perfectMs: 10, greatMs: 20, goodMs: 30, okayMs: 40 };

  it.each([
    [0, 'PERFECT'],
    [10, 'PERFECT'],
    [11, 'GREAT'],
    [20, 'GREAT'],
    [21, 'GOOD'],
    [30, 'GOOD'],
    [31, 'OKAY'],
    [40, 'OKAY'],
    [41, 'MISS'],
  ])('honours a custom window set: %i ms is %s', (absDeltaMs, expected) => {
    expect(judge(absDeltaMs, tight)).toBe(expected);
  });

  it('does not fall back to the defaults when given other windows', () => {
    // 100 ms is GOOD under the defaults and MISS under the tight set.
    expect(judge(100, tight)).toBe('MISS');
    expect(judge(100, DEFAULT_WINDOWS)).toBe('GOOD');
  });
});

describe('judge is a total function of the distance it is given', () => {
  /**
   * The signature says `absDeltaMs` is `|press − note|`, so a negative value is
   * a caller bug. API.md does not say what happens then; the safe behaviour is
   * to treat the magnitude, because the alternative — a negative slipping past
   * `<= perfectMs` — silently awards PERFECT to a press that was nowhere near.
   */
  it.each([-1, -35, -36, -161, -1000])('treats %i as the distance it is', (delta) => {
    expect(judge(delta, DEFAULT_WINDOWS)).toBe(judge(Math.abs(delta), DEFAULT_WINDOWS));
  });

  it('does not award PERFECT to a press that was nowhere near the note', () => {
    expect(judge(-1000, DEFAULT_WINDOWS)).toBe('MISS');
  });
});
