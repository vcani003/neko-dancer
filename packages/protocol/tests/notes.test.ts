/**
 * Individual notes.
 *
 * A note is the smallest thing the engine consumes, and the engine walks the
 * list forward without ever looking back — so anything out of order, or holding
 * a duration it should not have, is a bug that surfaces mid-song as a note that
 * cannot be hit.
 *
 * Notes are validated through `validateChartRevision` because that is the only
 * public door to them; each test changes one field of one note.
 */
import { describe, expect, it } from 'vitest';
import { MAX_NOTE_ID_LENGTH, MAX_NOTE_TIME_MS, validateChartRevision } from '@neko/protocol';
import { char, deeplyNested, errors, hold, revision, tap, value } from './helpers.ts';

const withNotes = (notes: unknown[]) => validateChartRevision(revision({ notes }));

describe('a note must be a note', () => {
  it.each([
    ['an array', []],
    ['a string', 'note'],
    ['a number', 1000],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['a deeply nested object', deeplyNested()],
  ])('rejects %s in the notes array', (_label, input) => {
    expect(withNotes([input]).ok).toBe(false);
  });

  it('does not recurse into a deeply nested object and blow the stack', () => {
    expect(() => withNotes([deeplyNested(50_000)])).not.toThrow();
  });
});

describe('a lane is a direction, never a key — ADR-001', () => {
  it.each([['left'], ['down'], ['up'], ['right']])('accepts the lane %s', (lane) => {
    expect(withNotes([tap({ lane })]).ok).toBe(true);
  });

  // The spec once wrote lanes as W/A/S/D. If those ever validate again, every
  // stored note becomes wrong for a player who rebinds their keys.
  it.each([['W'], ['A'], ['S'], ['D'], ['UP'], ['Up'], [0], [null], ['middle'], [undefined]])(
    'rejects %s as a lane',
    (lane) => {
      expect(withNotes([tap({ lane })]).ok).toBe(false);
    },
  );
});

describe('a note time is a real, absolute, in-range millisecond — ADR-003', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a negative time', -1],
    ['the numeric string "1000"', '1000'],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an object', {}],
    ['one past the six-hour ceiling', MAX_NOTE_TIME_MS + 1],
  ])('rejects %s as a timeMs', (_label, timeMs) => {
    expect(withNotes([tap({ timeMs })]).ok).toBe(false);
  });

  // -0 is a number, is finite, and is not less than 0, so every naive guard
  // lets it through. It then serialises as 0 but compares unequal under
  // Object.is, which is the sort of difference that surfaces in a diff of two
  // supposedly identical revisions.
  it('rejects negative zero, which passes every naive range check', () => {
    expect(withNotes([tap({ timeMs: -0 })]).ok).toBe(false);
  });

  it('accepts zero and the ceiling exactly', () => {
    expect(withNotes([tap({ timeMs: 0 })]).ok).toBe(true);
    expect(withNotes([tap({ timeMs: MAX_NOTE_TIME_MS })]).ok).toBe(true);
  });
});

describe('a tap and a hold are different shapes, not one shape with a flag', () => {
  it('rejects a tap that carries a durationMs', () => {
    expect(errors(withNotes([tap({ durationMs: 500 })]))[0]).toMatch(/tap/);
  });

  it('rejects a hold with no durationMs', () => {
    expect(withNotes([hold({ durationMs: undefined })]).ok).toBe(false);
  });

  it.each([
    ['a negative duration', -1],
    ['a zero duration', 0],
    ['negative zero', -0],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['the numeric string "500"', '500'],
    ['null', null],
  ])('rejects a hold with %s', (_label, durationMs) => {
    expect(withNotes([hold({ durationMs })]).ok).toBe(false);
  });

  it('rejects a hold that would run past the six-hour ceiling', () => {
    const result = withNotes([hold({ timeMs: MAX_NOTE_TIME_MS - 100, durationMs: 101 })]);
    expect(errors(result)[0]).toMatch(/holds past/);
  });

  it('accepts a hold that ends exactly at the ceiling', () => {
    expect(withNotes([hold({ timeMs: MAX_NOTE_TIME_MS - 100, durationMs: 100 })]).ok).toBe(true);
  });

  it.each([['tapp'], ['TAP'], [''], [null], [undefined], [0], ['release']])(
    'rejects the note type %s',
    (type) => {
      expect(withNotes([tap({ type })]).ok).toBe(false);
    },
  );
});

describe('a hold may span notes in other lanes — system design §8', () => {
  // The engine orders by START time only. A hold beginning at 1000 and running
  // to 3000 legitimately encloses a tap at 1500 in a different lane, and
  // rejecting that would make most real charts unrepresentable.
  it('accepts a hold that starts before and ends after a tap in another lane', () => {
    const result = withNotes([
      hold({ id: 'h', timeMs: 1000, lane: 'left', durationMs: 2000 }),
      tap({ id: 't', timeMs: 1500, lane: 'right' }),
    ]);
    expect(result.ok).toBe(true);
    expect(value(result).notes).toHaveLength(2);
  });
});

describe('note ids identify notes, and two notes cannot share one', () => {
  it('rejects a duplicate id', () => {
    expect(withNotes([tap({ id: 'same', timeMs: 1 }), tap({ id: 'same', timeMs: 2 })]).ok)
      .toBe(false);
  });

  /**
   * Two ids that look identical on screen but differ by an invisible character
   * are two rows in a database and one thing to a person reading a bug report.
   *
   * Asserts the guarantee — they cannot both be accepted — rather than the
   * mechanism. Rejecting the unclean id outright and folding it into a
   * duplicate are both valid answers, and a test that named one would fail on
   * the other for no good reason.
   */
  it.each([
    ['U+200B ZERO WIDTH SPACE', 0x200b],
    ['U+FEFF BYTE ORDER MARK', 0xfeff],
    ['U+00AD SOFT HYPHEN', 0x00ad],
    ['U+061C ARABIC LETTER MARK', 0x061c],
    ['U+202E RIGHT-TO-LEFT OVERRIDE', 0x202e],
  ])('refuses a chart holding two ids that differ only by %s', (_name, code) => {
    const result = withNotes([
      tap({ id: 'abc', timeMs: 1 }),
      tap({ id: `a${char(code)}bc`, timeMs: 2 }),
    ]);
    expect(result.ok).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    ['a number', 123],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['only invisible characters', char(0x200b) + char(0x3164)],
  ])('rejects %s as a note id', (_label, id) => {
    expect(withNotes([tap({ id })]).ok).toBe(false);
  });

  /**
   * REGRESSION — an identifier must never be silently rewritten.
   *
   * `validateNote` bounds the id with `sanitiseText(input.id,
   * MAX_NOTE_ID_LENGTH)`, which TRUNCATES. A 68-character id is therefore
   * accepted and stored as a different 64-character id, so a caller holding the
   * id it sent can no longer find its own note. Display text may be truncated;
   * an identifier may not.
   */
  it('rejects an over-long note id rather than truncating it to a different id', () => {
    const tooLong = 'x'.repeat(MAX_NOTE_ID_LENGTH + 4);
    expect(withNotes([tap({ id: tooLong })]).ok).toBe(false);
  });

  it('returns note ids byte-identical to the ones it was given', () => {
    const sent = 'x'.repeat(MAX_NOTE_ID_LENGTH + 4);
    const result = withNotes([tap({ id: sent })]);
    if (result.ok) expect(result.value.notes[0]!.id).toBe(sent);
  });

  /**
   * REGRESSION — truncation turns distinct ids into a collision.
   *
   * Two ids sharing a 64-character prefix both truncate to that prefix, so the
   * second is reported as "a duplicate id" naming an id that neither note
   * actually has. The chart is refused and the message misdescribes why.
   */
  it('does not collide two distinct ids that share the first 64 characters', () => {
    const prefix = 'y'.repeat(MAX_NOTE_ID_LENGTH);
    const result = withNotes([
      tap({ id: `${prefix}AAA`, timeMs: 1 }),
      tap({ id: `${prefix}BBB`, timeMs: 2 }),
    ]);
    expect(errors(result).join(' ')).not.toMatch(/duplicate/);
  });

  it('accepts an id of exactly the maximum length', () => {
    expect(withNotes([tap({ id: 'x'.repeat(MAX_NOTE_ID_LENGTH) })]).ok).toBe(true);
  });
});

describe('notes arrive in order, because the engine never looks back', () => {
  it('rejects notes out of order by a single millisecond', () => {
    const result = withNotes([tap({ id: 'a', timeMs: 1001 }), tap({ id: 'b', timeMs: 1000 })]);
    expect(errors(result).join(' ')).toMatch(/out of order/);
  });

  // Equal times are a chord: several lanes struck together. Forbidding them
  // would make every chart with a two-lane hit invalid.
  it('accepts several notes at the same instant in different lanes', () => {
    const result = withNotes([
      tap({ id: 'a', timeMs: 1000, lane: 'up' }),
      tap({ id: 'b', timeMs: 1000, lane: 'down' }),
      tap({ id: 'c', timeMs: 1000, lane: 'left' }),
      tap({ id: 'd', timeMs: 1000, lane: 'right' }),
    ]);
    expect(result.ok).toBe(true);
  });
});
