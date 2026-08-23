/**
 * Beatmap metadata — the parts of a beatmap a person types or chooses.
 *
 * This is where BL-3 lived: the title was sanitised only to test whether
 * anything readable was left, and the sanitised value was then thrown away. A
 * 100,000-character title passed the check and the caller kept the original.
 * The validator now returns what it approved.
 */
import { describe, expect, it } from 'vitest';
import {
  BEATMAP_STATUSES,
  DIFFICULTIES,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TITLE_LENGTH,
  validateBeatmapMetadata,
} from '@neko/protocol';
import { char, deeplyNested, errors, metadata, value } from './helpers.ts';

const check = (over: Record<string, unknown> = {}) => validateBeatmapMetadata(metadata(over));

describe('difficulty and status come from closed sets', () => {
  it.each(DIFFICULTIES.map((d) => [d]))('accepts the difficulty %s', (difficulty) => {
    expect(check({ difficulty }).ok).toBe(true);
  });

  it.each([['EASY'], ['Easy'], ['medium'], ['insane'], [''], [0], [null], [undefined], [{}]])(
    'rejects %s as a difficulty',
    (difficulty) => {
      expect(check({ difficulty }).ok).toBe(false);
    },
  );

  it.each(BEATMAP_STATUSES.map((s) => [s]))('accepts the status %s', (status) => {
    expect(check({ status }).ok).toBe(true);
  });

  it.each([['DRAFT'], ['deleted'], ['archived'], [''], [null], [undefined], [{}]])(
    'rejects %s as a status',
    (status) => {
      expect(check({ status }).ok).toBe(false);
    },
  );

  // `{}` inherits toString, valueOf and friends from Object.prototype. A
  // membership test done with `in` rather than a list would accept them.
  it.each([['toString'], ['valueOf'], ['constructor'], ['__proto__'], ['hasOwnProperty']])(
    'does not accept the inherited property name %s as a difficulty',
    (difficulty) => {
      expect(check({ difficulty }).ok).toBe(false);
    },
  );
});

describe('a title is a string, and the validator returns the one it approved', () => {
  it.each([
    ['an object', {}],
    ['an array', ['evil']],
    ['a number', 12345],
    ['a boolean', true],
    ['null', null],
    ['a deeply nested object', deeplyNested()],
  ])('rejects %s as a title rather than coercing it', (_label, title) => {
    expect(errors(check({ title }))[0]).toMatch(/must be a string/);
  });

  it('bounds a 100,000-character title to the limit and returns the bounded one', () => {
    const result = value(check({ title: 'a'.repeat(100_000) }));
    expect(result.title).toHaveLength(MAX_TITLE_LENGTH);
  });

  it.each([
    ['zero-width spaces', char(0x200b)],
    ['hangul fillers', char(0x3164)],
    ['braille blanks', char(0x2800)],
    ['byte order marks', char(0xfeff)],
    ['soft hyphens', char(0x00ad)],
  ])('rejects a title made entirely of %s', (_label, c) => {
    expect(errors(check({ title: c.repeat(6) }))[0]).toMatch(/readable/);
  });

  it('strips a bidi control from inside a title but keeps the title', () => {
    expect(value(check({ title: `ab${char(0x061c)}cd` })).title).toBe('abcd');
  });

  it('strips a line separator from inside a title', () => {
    expect(value(check({ title: `ab${char(0x2028)}cd` })).title).toBe('abcd');
  });

  it('omits the title entirely when none was given', () => {
    expect(value(check()).title).toBeUndefined();
  });

  it('trims a title rather than storing the whitespace', () => {
    expect(value(check({ title: '  Rain On Me  ' })).title).toBe('Rain On Me');
  });
});

describe('tags are normalised so the catalogue has one row per tag — §16', () => {
  it('folds case so Rock and rock are one tag', () => {
    expect(value(check({ tags: ['Rock', 'rock', 'ROCK'] })).tags).toEqual(['rock']);
  });

  it('de-duplicates repeated tags', () => {
    expect(value(check({ tags: Array(MAX_TAGS).fill('dup') })).tags).toEqual(['dup']);
  });

  it('keeps distinct tags in the order they were given', () => {
    expect(value(check({ tags: ['jpop', 'anime', 'fast'] })).tags).toEqual(['jpop', 'anime', 'fast']);
  });

  it(`rejects more than ${MAX_TAGS} tags`, () => {
    expect(check({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) }).ok).toBe(false);
  });

  it(`accepts exactly ${MAX_TAGS} tags`, () => {
    expect(check({ tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`) }).ok).toBe(true);
  });

  it.each([
    ['a nested array', [['nested']]],
    ['an object', [{}]],
    ['a number', [42]],
    ['null', [null]],
    ['undefined', [undefined]],
    ['an empty string', ['']],
    ['only invisible characters', [char(0x200b) + char(0x3164)]],
  ])('rejects a tag list containing %s', (_label, tags) => {
    expect(errors(check({ tags }))[0]).toMatch(/tag/);
  });

  it.each([
    ['a string', 'notanarray'],
    ['an object', {}],
    ['a number', 5],
  ])('rejects %s as the tag list', (_label, tags) => {
    expect(errors(check({ tags }))[0]).toMatch(/array/);
  });

  it('bounds a very long tag rather than storing it', () => {
    const [tag] = value(check({ tags: ['x'.repeat(500)] })).tags;
    expect(tag!.length).toBeLessThanOrEqual(MAX_TAG_LENGTH);
  });

  it('returns an empty list, never undefined, when no tags were given', () => {
    expect(value(check()).tags).toEqual([]);
  });
});

describe('the approved metadata carries nothing the caller did not earn', () => {
  it('drops unknown keys', () => {
    const result = value(check({ authorId: 'someone-else', isAdmin: true, tags: ['a'] }));
    expect(Object.keys(result).sort()).toEqual(['difficulty', 'status', 'tags']);
  });

  it.each([
    ['an array', []],
    ['a string', 'metadata'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s as the metadata object', (_label, input) => {
    expect(validateBeatmapMetadata(input).ok).toBe(false);
  });
});
