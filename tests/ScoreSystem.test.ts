import { describe, expect, it } from 'vitest';
import {
  BASE_POINTS,
  COMPLETION_BONUS,
  MAX_HEALTH,
  accuracy,
  applyCompletionBonus,
  applyJudgment,
  applyWrongKey,
  comboMultiplier,
  grade,
  initialScoreState,
  meanDeltaMs,
} from '../src/engine/ScoreSystem.ts';
import type { Judgment } from '../src/engine/LaneJudge.ts';

const play = (seq: Array<[Judgment, number]>) =>
  seq.reduce((s, [j, d]) => applyJudgment(s, j, d), initialScoreState());

describe('scoring', () => {
  /** CONFIRMED from the original: a Perfect at zero combo reads as 14. */
  it('pays 14 for a Perfect at zero combo', () => {
    expect(play([['PERFECT', 0]]).score).toBe(14);
    expect(BASE_POINTS.PERFECT).toBe(7);
  });

  it('pays a descending ladder below Perfect', () => {
    const points = (['PERFECT', 'NICE', 'OKAY', 'OOPS', 'MISS'] as Judgment[])
      .map((j) => BASE_POINTS[j]);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeLessThan(points[i - 1]);
    }
  });

  /** The multiplier is read before the arrow extends the combo. */
  it('never pays an arrow more in hindsight than it was worth on screen', () => {
    const nineteen = play(Array(19).fill(['PERFECT', 0]));
    expect(comboMultiplier(nineteen.combo)).toBe(2);
    const twentieth = applyJudgment(nineteen, 'PERFECT', 0);
    expect(twentieth.score - nineteen.score).toBe(14);
    const twentyfirst = applyJudgment(twentieth, 'PERFECT', 0);
    expect(twentyfirst.score - twentieth.score).toBe(21);
  });

  it('pays the completion bonus once', () => {
    expect(applyCompletionBonus(initialScoreState()).score).toBe(COMPLETION_BONUS);
  });
});

describe('combo', () => {
  it('survives Okay but not Oops', () => {
    expect(play([['PERFECT', 0], ['OKAY', 100]]).combo).toBe(2);
    expect(play([['PERFECT', 0], ['OOPS', 150]]).combo).toBe(0);
  });

  it('breaks on a miss and remembers the best run', () => {
    const state = play([['PERFECT', 0], ['PERFECT', 0], ['MISS', 0], ['PERFECT', 0]]);
    expect(state.combo).toBe(1);
    expect(state.maxCombo).toBe(2);
  });
});

describe('health — the mechanic hop//beat never had', () => {
  it('starts full', () => {
    expect(initialScoreState().health).toBe(MAX_HEALTH);
    expect(initialScoreState().failed).toBe(false);
  });

  it('drains on misses and recovers on hits', () => {
    const hurt = play([['MISS', 0], ['MISS', 0]]);
    expect(hurt.health).toBeLessThan(MAX_HEALTH);
    expect(applyJudgment(hurt, 'PERFECT', 0).health).toBeGreaterThan(hurt.health);
  });

  it('never exceeds full however well the player does', () => {
    expect(play(Array(50).fill(['PERFECT', 0])).health).toBe(MAX_HEALTH);
  });

  /** Recovery is slower than damage, so a bad patch is felt. */
  it('costs more to miss than a hit gives back', () => {
    const base = initialScoreState();
    const afterMiss = applyJudgment(base, 'MISS', 0);
    const lost = base.health - afterMiss.health;
    const gained = applyJudgment(afterMiss, 'PERFECT', 0).health - afterMiss.health;
    expect(lost).toBeGreaterThan(gained);
  });

  it('fails at zero, and stays failed', () => {
    const dead = play(Array(30).fill(['MISS', 0]));
    expect(dead.health).toBe(0);
    expect(dead.failed).toBe(true);
    expect(applyJudgment(dead, 'PERFECT', 0).failed).toBe(true);
  });

  it('grades a failed run F regardless of accuracy', () => {
    let state = play(Array(40).fill(['PERFECT', 0]));
    state = { ...state, failed: true };
    expect(grade(state)).toBe('F');
  });
});

describe('wrong keys', () => {
  /**
   * Unlike hop//beat, where extra movement was free because moving is the
   * point, a keypress is deliberate — and the original drains health for one.
   */
  it('costs health and breaks the combo', () => {
    const state = applyWrongKey(play([['PERFECT', 0], ['PERFECT', 0]]));
    expect(state.combo).toBe(0);
    expect(state.health).toBeLessThan(MAX_HEALTH);
    expect(state.wrongKeys).toBe(1);
  });

  it('does not count as a judged arrow', () => {
    const state = applyWrongKey(initialScoreState());
    expect(state.judgedCount).toBe(0);
    expect(state.score).toBe(0);
  });

  it('can fail a run on its own', () => {
    let state = initialScoreState();
    for (let i = 0; i < 40; i++) state = applyWrongKey(state);
    expect(state.failed).toBe(true);
  });
});

describe('accuracy and timing', () => {
  it('is perfect before anything is judged', () => {
    expect(accuracy(initialScoreState())).toBe(1);
  });

  it('weights each judgment by what it was worth', () => {
    expect(accuracy(play([['PERFECT', 0]]))).toBeCloseTo(1);
    expect(accuracy(play([['MISS', 0]]))).toBeCloseTo(0);
    expect(accuracy(play([['NICE', 0]]))).toBeCloseTo(5 / 7);
  });

  it('reports which way the player is off', () => {
    expect(meanDeltaMs(play([['NICE', 50], ['NICE', 70]]))).toBeCloseTo(60);
    expect(meanDeltaMs(play([['NICE', -40]]))).toBeCloseTo(-40);
  });

  it('has no timing opinion when nothing was hit', () => {
    expect(meanDeltaMs(play([['MISS', 0]]))).toBeNull();
  });
});
