/**
 * The timing map — system design §7.
 *
 * A single bpm+offset cannot describe a song that changes tempo or a recording
 * that drifts; a list of anchors can. `beat` is what lets a later point
 * re-align a drifting recording without moving everything before it, which it
 * cannot do if it is allowed to point backwards or sit at the same instant as
 * its neighbour.
 */
import { describe, expect, it } from 'vitest';
import { MAX_BPM, MAX_TIMING_POINTS, MIN_BPM, validateTiming } from '@neko/protocol';
import { deeplyNested } from './helpers.ts';

/** `validateTiming` reports through an out-param, so give it one and read both. */
function check(input: unknown) {
  const errors: string[] = [];
  const map = validateTiming(input, errors);
  return { ok: map !== null, map, errors };
}

describe('a timing map is a non-empty array of points', () => {
  it.each([
    ['an object', {}],
    ['a string', '128'],
    ['a number', 128],
    ['null', null],
    ['undefined', undefined],
    ['an object pretending to be an array', { 0: { timeMs: 0, bpm: 128, beat: 0 }, length: 1 }],
  ])('rejects %s', (_label, input) => {
    expect(check(input).ok).toBe(false);
  });

  it('rejects an empty map, because a chart with no grid has no grid', () => {
    expect(check([]).ok).toBe(false);
  });

  it('accepts the simple case: one point at the start of the song', () => {
    expect(check([{ timeMs: 0, bpm: 128, beat: 0 }]).ok).toBe(true);
  });

  it(`rejects more than ${MAX_TIMING_POINTS} points`, () => {
    const tooMany = Array.from({ length: MAX_TIMING_POINTS + 1 }, (_, i) => ({
      timeMs: i * 1000, bpm: 128, beat: i * 2,
    }));
    expect(check(tooMany).ok).toBe(false);
  });

  it(`accepts exactly ${MAX_TIMING_POINTS} points`, () => {
    const exact = Array.from({ length: MAX_TIMING_POINTS }, (_, i) => ({
      timeMs: i * 1000, bpm: 128, beat: i * 2,
    }));
    expect(check(exact).ok).toBe(true);
  });

  it.each([
    ['an array', []],
    ['a string', 'x'],
    ['null', null],
    ['a deeply nested object', deeplyNested()],
  ])('rejects %s as a timing point', (_label, point) => {
    expect(check([point]).ok).toBe(false);
  });
});

describe('a tempo change is the whole reason this is a list — §7', () => {
  it('accepts a song that changes tempo halfway through', () => {
    const result = check([
      { timeMs: 0, bpm: 128, beat: 0 },
      { timeMs: 92_000, bpm: 132, beat: 196 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.map).toHaveLength(2);
  });

  it('accepts a later anchor re-aligning a drifting recording at the same tempo', () => {
    expect(check([
      { timeMs: 237, bpm: 120, beat: 0 },
      { timeMs: 120_500, bpm: 120, beat: 240 },
    ]).ok).toBe(true);
  });
});

describe('the map cannot give two answers for one moment', () => {
  // Two points at the same instant make "what is the tempo here?" ambiguous,
  // and whichever one wins is whichever the reader happens to visit last.
  it('rejects two points at the same timeMs', () => {
    const result = check([
      { timeMs: 0, bpm: 128, beat: 0 },
      { timeMs: 0, bpm: 200, beat: 0 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/at or before/);
  });

  it('rejects points that run backwards in time', () => {
    expect(check([
      { timeMs: 5000, bpm: 128, beat: 10 },
      { timeMs: 1000, bpm: 128, beat: 2 },
    ]).ok).toBe(false);
  });

  // A later anchor exists to re-align a drifting recording. It cannot do that
  // if its beat number is allowed to precede the anchor before it.
  it('rejects a beat that runs backwards while time runs forwards', () => {
    const result = check([
      { timeMs: 0, bpm: 128, beat: 100 },
      { timeMs: 5000, bpm: 128, beat: 0 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/beat before/);
  });
});

describe('every field of a timing point is a real number in range', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a negative time', -1],
    ['negative zero', -0],
    ['the numeric string "0"', '0'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as a timeMs', (_label, timeMs) => {
    expect(check([{ timeMs, bpm: 128, beat: 0 }]).ok).toBe(false);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['a negative bpm', -128],
    [`one below MIN_BPM (${MIN_BPM})`, MIN_BPM - 1],
    [`one above MAX_BPM (${MAX_BPM})`, MAX_BPM + 1],
    ['the numeric string "128"', '128'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as a bpm', (_label, bpm) => {
    expect(check([{ timeMs: 0, bpm, beat: 0 }]).ok).toBe(false);
  });

  it('accepts the bpm bounds exactly', () => {
    expect(check([{ timeMs: 0, bpm: MIN_BPM, beat: 0 }]).ok).toBe(true);
    expect(check([{ timeMs: 0, bpm: MAX_BPM, beat: 0 }]).ok).toBe(true);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a negative beat', -1],
    ['a fractional beat', 0.5],
    ['the numeric string "0"', '0'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as a beat', (_label, beat) => {
    expect(check([{ timeMs: 0, bpm: 128, beat }]).ok).toBe(false);
  });
});

describe('the returned map carries only the three fields of a timing point', () => {
  // Built field by field rather than aliased, so an unknown key in the payload
  // cannot ride along into storage.
  it('drops unknown keys', () => {
    const result = check([{ timeMs: 0, bpm: 128, beat: 0, evil: 'payload', __proto__: { x: 1 } }]);
    expect(result.ok).toBe(true);
    expect(Object.keys(result.map![0]!)).toEqual(['timeMs', 'bpm', 'beat']);
  });
});
