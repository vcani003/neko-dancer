/**
 * A whole chart revision.
 *
 * The doc on `validateChartRevision` claims it guards an upload, a chart read
 * back from the database, and a revision fetched by a client. The first version
 * checked the notes and the timing and none of the revision's own identity, so
 * `{ id: {evil: true}, beatmapId: 999 }` was accepted and then cast to
 * `ChartRevision` by the caller. Stored data outlives the code that wrote it —
 * "we validated it on the way in" is not a reason to skip validating it on the
 * way out.
 */
import { describe, expect, it } from 'vitest';
import {
  CHART_SCHEMA_VERSION,
  MAX_NOTES,
  validateChartRevision,
} from '@neko/protocol';
import { UUID_A, UUID_B, deeplyNested, errors, revision, tap, value } from './helpers.ts';

const check = (over: Record<string, unknown> = {}) => validateChartRevision(revision(over));

describe('a revision must be an object, and only an object', () => {
  it.each([
    ['an array', []],
    ['a populated array', [1, 2, 3]],
    ['a string', 'chart'],
    ['a number', 2],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
  ])('rejects %s', (_label, input) => {
    expect(validateChartRevision(input).ok).toBe(false);
  });

  it('accepts a complete, well-formed revision', () => {
    expect(check().ok).toBe(true);
  });
});

describe('a revision carries its own identity, and it is checked', () => {
  it.each([
    ['an object', {}],
    ['a number', 999],
    ['a bare word', 'revision_123'],
    ['null', null],
    ['undefined', undefined],
    ['a constructed id from the previous build', 'youtube:abc#vero#v2'],
  ])('rejects %s as the revision id', (_label, id) => {
    expect(check({ id }).ok).toBe(false);
  });

  it.each([
    ['an object', {}],
    ['a number', 999],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as the beatmapId', (_label, beatmapId) => {
    expect(check({ beatmapId }).ok).toBe(false);
  });

  it.each([
    ['a sentence', 'not a date'],
    ['an empty string', ''],
    ['a number', 1767225600000],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('rejects %s as createdAtIso', (_label, createdAtIso) => {
    expect(check({ createdAtIso }).ok).toBe(false);
  });
});

describe('the schema version is a hard gate — ADR-008', () => {
  // v1 is abandoned rather than migrated: the only v1 charts in existence live
  // in individual browsers this code cannot reach. The rejection is the
  // decision, not an oversight.
  it.each([[1], [0], [3], ['2'], [null], [undefined], [NaN], [2.5]])(
    'rejects schemaVersion %s',
    (schemaVersion) => {
      expect(check({ schemaVersion }).ok).toBe(false);
    },
  );

  it('accepts the version this build reads', () => {
    expect(check({ schemaVersion: CHART_SCHEMA_VERSION }).ok).toBe(true);
  });

  it('names the version it wanted, so the failure is diagnosable', () => {
    expect(errors(check({ schemaVersion: 1 }))[0]).toContain(String(CHART_SCHEMA_VERSION));
  });
});

describe('a revision number orders a beatmap history, so it is a whole number', () => {
  // "The next revision" is undefined if 1.5 can exist between 1 and 2.
  it.each([
    ['a fraction', 1.5],
    ['zero', 0],
    ['a negative', -1],
    ['a number too large to survive JSON', 1e308],
    ['a number past the safe integer range', Number.MAX_SAFE_INTEGER + 2],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['the numeric string "1"', '1'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as a revision number', (_label, rev) => {
    expect(check({ revision: rev }).ok).toBe(false);
  });

  it('accepts the first revision', () => {
    expect(value(check({ revision: 1 })).revision).toBe(1);
  });
});

describe('the optional generator fields are checked when present', () => {
  it.each([
    ['an object', {}],
    ['a number', 42],
    ['an array', []],
  ])('rejects %s as generatorVersion', (_label, generatorVersion) => {
    expect(check({ generatorVersion }).ok).toBe(false);
  });

  it.each([
    ['a string', 'abc'],
    ['a fraction', 1.5],
    ['NaN', NaN],
    ['an object', {}],
  ])('rejects %s as generatorSeed', (_label, generatorSeed) => {
    expect(check({ generatorSeed }).ok).toBe(false);
  });

  it('accepts a revision that omits both', () => {
    expect(check().ok).toBe(true);
  });

  it('keeps both when they are well formed', () => {
    const result = value(check({ generatorVersion: 'v3', generatorSeed: 12345 }));
    expect(result.generatorVersion).toBe('v3');
    expect(result.generatorSeed).toBe(12345);
  });
});

describe('a chart is bounded, because an unbounded one is a claim worth refusing', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => tap({ id: `n${i}`, timeMs: i }));

  it(`rejects ${MAX_NOTES + 1} notes`, () => {
    expect(check({ notes: many(MAX_NOTES + 1) }).ok).toBe(false);
  });

  it(`accepts exactly ${MAX_NOTES} notes`, () => {
    expect(check({ notes: many(MAX_NOTES) }).ok).toBe(true);
  });

  it.each([
    ['an object', { 0: tap() }],
    ['a string', 'notes'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 5],
  ])('rejects %s as the notes array', (_label, notes) => {
    expect(check({ notes }).ok).toBe(false);
  });

  it('accepts an empty chart but says so', () => {
    const result = check({ notes: [] });
    expect(result.ok).toBe(true);
    expect(value(result)).toBeDefined();
    if (result.ok) expect(result.warnings.join(' ')).toMatch(/no notes/);
  });
});

describe('the validated value is built, not aliased', () => {
  /**
   * A validator that returns `{ ok: boolean }` forces its caller to write
   * `if (check(x).ok) { const c = x as Chart }` — the cast `ENGINEERING.md` §1
   * names as forbidden. The value that comes back must be safe to store as-is.
   */
  it('carries only the fields a ChartRevision has', () => {
    const result = value(check({ evilKey: 'payload', anotherOne: [1, 2, 3] }));
    expect(Object.keys(result).sort()).toEqual(
      ['beatmapId', 'createdAtIso', 'id', 'notes', 'revision', 'schemaVersion', 'timing'].sort(),
    );
  });

  it('does not let an unknown key ride along into storage', () => {
    const result = value(check({ isAdmin: true }));
    expect((result as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it('returns the ids as the branded values, not as the raw input object', () => {
    const result = value(check());
    expect(result.id).toBe(UUID_A);
    expect(result.beatmapId).toBe(UUID_B);
  });

  it('rebuilds each note rather than passing the input note through', () => {
    const input = tap({ id: 'n1', timeMs: 5, evil: 'payload' });
    const result = value(check({ notes: [input] }));
    expect(result.notes[0]).not.toBe(input);
    expect(Object.keys(result.notes[0]!).sort()).toEqual(['id', 'lane', 'timeMs', 'type']);
  });
});

describe('nothing in a payload can reach Object.prototype', () => {
  // JSON.parse makes `__proto__` an own property rather than a setter, and this
  // validator only ever reads. Both halves are asserted because either one
  // changing would reopen the hole.
  it('does not pollute the prototype from a __proto__ key', () => {
    const hostile = JSON.parse(
      '{"schemaVersion":2,"revision":1,"__proto__":{"polluted":"yes"},"notes":[],"timing":[]}',
    );
    validateChartRevision(hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([['__proto__'], ['constructor'], ['prototype']])(
    'treats a note id of "%s" as an ordinary string',
    (id) => {
      const result = check({ notes: [tap({ id })] });
      expect(result.ok).toBe(true);
      expect(value(result).notes[0]!.id).toBe(id);
    },
  );

  it('still catches a duplicate when the id is "__proto__"', () => {
    const result = check({
      notes: [tap({ id: '__proto__', timeMs: 1 }), tap({ id: '__proto__', timeMs: 2 })],
    });
    expect(errors(result).join(' ')).toMatch(/duplicate/);
  });

  it('does not pollute the prototype through a constructor key', () => {
    validateChartRevision(JSON.parse('{"constructor":{"prototype":{"polluted":"yes"}}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('a hostile payload is refused rather than crashing the process', () => {
  // ENGINEERING.md §0: one PICK_SONG message from any unauthenticated client on
  // the network exited the whole server. A validator that throws is a validator
  // that has become the attack.
  it.each([
    ['a deeply nested revision', deeplyNested()],
    ['a deeply nested timing map', { timing: deeplyNested() }],
    ['a deeply nested notes array', { notes: [deeplyNested()] }],
    ['an object with no fields at all', {}],
    ['an object whose every field is null', {
      id: null, beatmapId: null, schemaVersion: null, revision: null,
      timing: null, notes: null, createdAtIso: null,
    }],
  ])('refuses %s without throwing', (_label, input) => {
    expect(() => validateChartRevision(input)).not.toThrow();
    expect(validateChartRevision(input).ok).toBe(false);
  });

  it('reports every problem it found rather than only the first', () => {
    const result = check({ schemaVersion: 9, revision: -1, createdAtIso: 'nope' });
    expect(errors(result).length).toBeGreaterThanOrEqual(3);
  });
});
