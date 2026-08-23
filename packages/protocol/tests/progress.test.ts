/**
 * Self-reported scores.
 *
 * §25 and the plan both record that the server stores what the client claims
 * and does not verify it. That makes bounding the claim the only protection
 * there is: an unbounded claim is a scoreboard with `Infinity` at the top and a
 * database column that overflows. `MAX_PLAUSIBLE_SCORE` existed as a constant
 * and bounded nothing until these validators were written.
 */
import { describe, expect, it } from 'vitest';
import {
  JUDGMENTS,
  MAX_COMBO,
  MAX_PLAUSIBLE_SCORE,
  validateProgress,
  validateRoundResult,
} from '@neko/protocol';
import { counts, deeplyNested, progress, roundResult, value } from './helpers.ts';

describe('a progress report is four real numbers in range', () => {
  it('accepts a plausible one', () => {
    expect(value(validateProgress(progress()))).toEqual(progress());
  });

  it.each([
    ['an array', []],
    ['a string', 'good'],
    ['a number', 5],
    ['null', null],
    ['undefined', undefined],
    ['a deeply nested object', deeplyNested()],
  ])('rejects %s', (_label, input) => {
    expect(validateProgress(input).ok).toBe(false);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a negative score', -1],
    ['negative zero', -0],
    ['one past the plausible ceiling', MAX_PLAUSIBLE_SCORE + 1],
    ['a wildly implausible score', 1e12],
    ['the numeric string "1000"', '1000'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as a score', (_label, score) => {
    expect(validateProgress(progress({ score })).ok).toBe(false);
  });

  it('accepts a score of zero and a score at the ceiling', () => {
    expect(validateProgress(progress({ score: 0 })).ok).toBe(true);
    expect(validateProgress(progress({ score: MAX_PLAUSIBLE_SCORE })).ok).toBe(true);
  });

  it.each([
    ['NaN', NaN],
    ['a negative combo', -1],
    ['one past the ceiling', MAX_COMBO + 1],
    ['Infinity', Infinity],
    ['a numeric string', '12'],
  ])('rejects %s as a combo', (_label, combo) => {
    expect(validateProgress(progress({ combo })).ok).toBe(false);
  });

  // Accuracy is a fraction, not a percentage. 100 would be a hundred times
  // perfect, and whichever renderer assumed the other convention would be
  // silently wrong rather than loudly.
  it.each([
    ['above one', 1.0001],
    ['a percentage', 95],
    ['a negative', -0.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a numeric string', '0.95'],
  ])('rejects %s as an accuracy', (_label, accuracy) => {
    expect(validateProgress(progress({ accuracy })).ok).toBe(false);
  });

  it('accepts both ends of the accuracy range', () => {
    expect(validateProgress(progress({ accuracy: 0 })).ok).toBe(true);
    expect(validateProgress(progress({ accuracy: 1 })).ok).toBe(true);
  });

  it.each([
    ['above one hundred', 101],
    ['a negative', -1],
    ['NaN', NaN],
    ['a numeric string', '80'],
  ])('rejects %s as health', (_label, health) => {
    expect(validateProgress(progress({ health })).ok).toBe(false);
  });

  it('accepts both ends of the health range', () => {
    expect(validateProgress(progress({ health: 0 })).ok).toBe(true);
    expect(validateProgress(progress({ health: 100 })).ok).toBe(true);
  });

  it('returns only the four fields, dropping anything else claimed', () => {
    const result = value(validateProgress(progress({ rank: 1, isWinner: true })));
    expect(Object.keys(result).sort()).toEqual(['accuracy', 'combo', 'health', 'score']);
  });
});

describe('a finished run reports a count for every grade', () => {
  it('accepts a complete result', () => {
    expect(value(validateRoundResult(roundResult()))).toEqual(roundResult());
  });

  it.each(JUDGMENTS.map((j) => [j]))('rejects a result missing the %s count', (missing) => {
    const partial = counts();
    delete (partial as Record<string, unknown>)[missing];
    expect(validateRoundResult(roundResult({ counts: partial })).ok).toBe(false);
  });

  it.each([
    ['an array', []],
    ['a string', 'lots'],
    ['a number', 5],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as the counts object', (_label, c) => {
    expect(validateRoundResult(roundResult({ counts: c })).ok).toBe(false);
  });

  it.each([
    ['a negative count', -1],
    ['a fractional count', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a numeric string', '10'],
    ['null', null],
    ['a count past the safe integer range', Number.MAX_SAFE_INTEGER + 2],
  ])('rejects %s in a grade tally', (_label, n) => {
    expect(validateRoundResult(roundResult({ counts: counts({ MISS: n }) })).ok).toBe(false);
  });

  it('rejects a result whose maxCombo is implausible', () => {
    expect(validateRoundResult(roundResult({ maxCombo: MAX_COMBO + 1 })).ok).toBe(false);
    expect(validateRoundResult(roundResult({ maxCombo: -1 })).ok).toBe(false);
  });

  it.each([
    ['a string', 'yes'],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as completed', (_label, completed) => {
    expect(validateRoundResult(roundResult({ completed })).ok).toBe(false);
  });

  it('rejects a result whose progress half is invalid', () => {
    expect(validateRoundResult(roundResult({ score: Infinity })).ok).toBe(false);
  });

  it('returns a counts object holding exactly the declared grades', () => {
    const result = value(validateRoundResult(roundResult({
      counts: counts({ SSS: 999, __proto__: { polluted: 'yes' } }),
    })));
    expect(Object.keys(result.counts).sort()).toEqual([...JUDGMENTS].sort());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns only the fields a RoundResult has', () => {
    const result = value(validateRoundResult(roundResult({ rank: 1, cheated: true })));
    expect(Object.keys(result).sort()).toEqual(
      ['accuracy', 'combo', 'completed', 'counts', 'health', 'maxCombo', 'score'].sort(),
    );
  });
});
