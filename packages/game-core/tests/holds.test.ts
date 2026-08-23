/**
 * Holds — API.md §4, new in Phase 1.
 *
 * Three rules, deliberately simple:
 *   - Missing the start misses the whole hold.
 *   - Releasing early ends it; the hold scores by the fraction held.
 *   - Still holding at the end scores it in full.
 *
 * Anything cleverer — re-grabbing a dropped hold, partial-credit curves — is
 * Phase 8. Tests here assert the simple rules and deliberately do NOT assert
 * a re-grab behaviour in either direction, because API.md leaves it open and a
 * test that guessed would be inventing contract.
 */
import { describe, expect, it } from 'vitest';
import { GameEngine } from '@neko/game-core';
import { DEFAULT_WINDOWS } from '@neko/protocol';
import { chartOf, hold } from './helpers.ts';

/** One hold: starts at 10,000, runs for 2,000 ms, ends at 12,000. */
const holdChart = () => chartOf([hold('h1', 10_000, 2_000)]);
const engineOf = () => new GameEngine({ revision: holdChart() });

describe('a hold starts exactly like a tap', () => {
  it.each([
    [10_000, 'PERFECT'],
    [10_035, 'PERFECT'],
    [10_036, 'GREAT'],
    [10_070, 'GREAT'],
    [10_110, 'GOOD'],
    [10_160, 'OKAY'],
  ])('a press at %i grades the start as %s', (pressAt, expected) => {
    expect(engineOf().press('up', pressAt)?.judgment).toBe(expected);
  });

  it('claims the hold by its own id', () => {
    expect(engineOf().press('up', 10_000)?.noteId).toBe('h1');
  });
});

describe('missing the start misses the whole hold', () => {
  /**
   * The player never grabbed it, so there is nothing to sustain. Awarding
   * sustain credit for a hold that was never started would let someone score by
   * leaning on a key through a section they never engaged with.
   */
  it('marks the hold missed when the start window closes unpressed', () => {
    const engine = engineOf();
    const expired = engine.update(10_000 + DEFAULT_WINDOWS.okayMs + 1);
    expect(expired).toHaveLength(1);
    expect(engine.result().counts.MISS).toBe(1);
  });

  it('gives no credit for holding a key down through a hold that was never started', () => {
    const engine = engineOf();
    engine.update(10_000 + DEFAULT_WINDOWS.okayMs + 1);
    const scoreAfterMiss = engine.result().score;
    engine.release('up', 12_000);
    engine.update(13_000);
    expect(engine.result().score).toBe(scoreAfterMiss);
  });

  it('does not let a late press revive a hold whose start already expired', () => {
    const engine = engineOf();
    engine.update(10_000 + DEFAULT_WINDOWS.okayMs + 1);
    expect(engine.press('up', 11_000)).toBeNull();
  });
});

describe('still holding at the end scores the hold in full', () => {
  it('scores more than an identical hold released halfway', () => {
    const full = engineOf();
    full.press('up', 10_000);
    full.update(12_000);
    full.release('up', 12_000);
    full.update(13_000);

    const half = engineOf();
    half.press('up', 10_000);
    half.update(11_000);
    half.release('up', 11_000);
    half.update(13_000);

    expect(full.result().score).toBeGreaterThan(half.result().score);
  });

  it('counts a fully held hold as completed rather than missed', () => {
    const engine = engineOf();
    engine.press('up', 10_000);
    engine.update(12_000);
    engine.release('up', 12_000);
    engine.update(13_000);
    expect(engine.result().counts.MISS).toBe(0);
  });

  it('does not require a release at all if the run ends while it is held', () => {
    const engine = engineOf();
    engine.press('up', 10_000);
    engine.update(13_000);
    expect(engine.result().counts.MISS).toBe(0);
  });
});

describe('releasing early scores by the fraction held', () => {
  /**
   * Monotonic in the fraction: a longer hold is worth more than a shorter one,
   * and neither is worth more than the whole. The exact curve is not specified
   * by API.md — see the report — so these assert only the ordering, which is
   * the part the document does fix.
   */
  const scoreAfterHolding = (untilMs: number) => {
    const engine = engineOf();
    engine.press('up', 10_000);
    engine.update(untilMs);
    engine.release('up', untilMs);
    engine.update(13_000);
    return engine.result().score;
  };

  it('scores a longer hold above a shorter one', () => {
    const quarter = scoreAfterHolding(10_500);
    const half = scoreAfterHolding(11_000);
    const threeQuarters = scoreAfterHolding(11_500);
    expect(half).toBeGreaterThan(quarter);
    expect(threeQuarters).toBeGreaterThan(half);
  });

  it('never scores a partial hold above a complete one', () => {
    expect(scoreAfterHolding(11_999)).toBeLessThanOrEqual(scoreAfterHolding(12_000));
  });

  it('gives an immediate release little more than the start was worth', () => {
    const engine = engineOf();
    engine.press('up', 10_000);
    engine.release('up', 10_001);
    engine.update(13_000);
    expect(engine.result().score).toBeLessThan(scoreAfterHolding(12_000));
  });

  it('treats a release after the hold has ended as a full hold', () => {
    // The key came up late, after the note finished. The player did everything
    // asked of them; a late release must not retroactively reduce the credit.
    const late = engineOf();
    late.press('up', 10_000);
    late.update(12_500);
    late.release('up', 12_500);
    late.update(13_000);
    expect(late.result().score).toBe(scoreAfterHolding(12_000));
  });
});

describe('release is safe to call whenever', () => {
  // "Only meaningful for holds; safe to call otherwise." The input layer does
  // not know what kind of note is under the key, so it always calls it.
  it('does not throw when nothing is being held', () => {
    expect(() => engineOf().release('up', 10_000)).not.toThrow();
  });

  it('does not throw when released twice', () => {
    const engine = engineOf();
    engine.press('up', 10_000);
    engine.release('up', 11_000);
    expect(() => engine.release('up', 11_500)).not.toThrow();
  });

  it('does not throw when a lane with no notes is released', () => {
    expect(() => engineOf().release('left', 10_000)).not.toThrow();
  });

  it('does not change a tap already judged', () => {
    const engine = new GameEngine({ revision: chartOf([{ id: 't1', timeMs: 10_000, lane: 'up', type: 'tap' }]) });
    engine.press('up', 10_000);
    const before = engine.result().score;
    engine.release('up', 10_500);
    engine.update(11_000);
    expect(engine.result().score).toBe(before);
  });
});
