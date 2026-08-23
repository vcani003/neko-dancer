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
  nextGrade,
  suggestedOffsetMs,
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
    const points = (['PERFECT', 'GREAT', 'GOOD', 'OKAY', 'MISS'] as Judgment[])
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
    expect(play([['PERFECT', 0], ['GOOD', 100]]).combo).toBe(2);
    expect(play([['PERFECT', 0], ['OKAY', 150]]).combo).toBe(0);
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
    expect(accuracy(play([['GREAT', 0]]))).toBeCloseTo(5 / 7);
  });

  it('reports which way the player is off', () => {
    expect(meanDeltaMs(play([['GREAT', 50], ['GREAT', 70]]))).toBeCloseTo(60);
    expect(meanDeltaMs(play([['GREAT', -40]]))).toBeCloseTo(-40);
  });

  it('has no timing opinion when nothing was hit', () => {
    expect(meanDeltaMs(play([['MISS', 0]]))).toBeNull();
  });
});

describe('grades and calibration — "why did I get a D"', () => {
  /**
   * A real run: 53 arrows, 47 of them hit, and a D. The player hit 89% of the
   * arrows and scored 62% accuracy, because accuracy weights HOW CLOSE each
   * hit was — and a systematic 43 ms early bias pushed most of them out of
   * PERFECT and into GREAT.
   */
  const realRun = () => {
    let state = initialScoreState();
    for (let i = 0; i < 10; i++) state = applyJudgment(state, 'PERFECT', -20);
    for (let i = 0; i < 25; i++) state = applyJudgment(state, 'GREAT', -50);
    for (let i = 0; i < 12; i++) state = applyJudgment(state, 'GOOD', -80);
    for (let i = 0; i < 6; i++) state = applyJudgment(state, 'MISS', 0);
    return state;
  };

  it('reproduces the reported result', () => {
    const state = realRun();
    expect(state.judgedCount).toBe(53);
    expect(accuracy(state)).toBeCloseTo(231 / 371, 3);
    expect(grade(state)).toBe('D');
  });

  it('hitting most arrows is not the same as accuracy', () => {
    const state = realRun();
    const hitRate = (state.judgedCount - state.counts.MISS) / state.judgedCount;
    expect(hitRate).toBeGreaterThan(0.88);
    expect(accuracy(state)).toBeLessThan(0.65);
  });

  it('says what the next grade needs, so it can be chased', () => {
    expect(nextGrade(realRun())).toEqual({ grade: 'C', min: 0.7 });
  });

  it('has no next grade at the top', () => {
    expect(nextGrade(play(Array(20).fill(['PERFECT', 0])))).toBeNull();
  });

  /** The point of the whole exercise: the bias is fixable, the skill was fine. */
  it('offers the offset that would centre a consistently early player', () => {
    // Mean of 10 at -20, 25 at -50 and 12 at -80 is -51.3; misses carry no
    // timing and are excluded.
    expect(meanDeltaMs(realRun())).toBeCloseTo(-51.3, 1);
    expect(suggestedOffsetMs(realRun(), 0)).toBe(51);
  });

  /** And the correction has to actually move the grade, or it is theatre. */
  it('turns the same playing into a much better grade once centred', () => {
    // The same run with the bias removed: those GREAT hits were 50 ms out, and
    // 50 ms of that was a clock disagreement rather than the player.
    let centred = initialScoreState();
    for (let i = 0; i < 35; i++) centred = applyJudgment(centred, 'PERFECT', 1);
    for (let i = 0; i < 12; i++) centred = applyJudgment(centred, 'GREAT', 30);
    for (let i = 0; i < 6; i++) centred = applyJudgment(centred, 'MISS', 0);

    expect(accuracy(centred)).toBeGreaterThan(accuracy(realRun()));
    expect(['A', 'B']).toContain(grade(centred));
  });

  it('offers the opposite for a consistently late player', () => {
    const late = play(Array(20).fill(['GREAT', 45]));
    expect(suggestedOffsetMs(late, 0)).toBe(-45);
  });

  it('adjusts relative to an offset already in use', () => {
    const state = play(Array(20).fill(['GREAT', 30]));
    expect(suggestedOffsetMs(state, 20)).toBe(-10);
  });

  it('suggests nothing to a player who is already centred', () => {
    expect(suggestedOffsetMs(play(Array(20).fill(['PERFECT', 3])), 0)).toBeNull();
  });

  it('suggests nothing from too few hits to be sure', () => {
    expect(suggestedOffsetMs(play([['GREAT', 60], ['GREAT', 60]]), 0)).toBeNull();
  });
});
