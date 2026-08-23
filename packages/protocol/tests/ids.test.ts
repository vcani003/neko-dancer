/**
 * Identifiers.
 *
 * §30 replaced constructed ids (`youtube:abc#vero#v2`) with generated ones, so
 * a shape check is the only thing between a database lookup and a string
 * someone typed. Room ids are the exception and get an allowlist: a room id is
 * the one identifier a person controls, and historically the one that ends up
 * in a path (`ENGINEERING.md` §4).
 */
import { describe, expect, it } from 'vitest';
import { asId, isRoomId, isUuid, newId, toRoomId } from '@neko/protocol';
import { UUID_A, char } from './helpers.ts';

describe('asId refuses anything that is not a generated id', () => {
  it.each([
    ['an empty string', ''],
    ['a bare word', 'kitchen'],
    ['a number', 12345],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['an array holding one', [UUID_A]],
    ['a uuid in braces', `{${UUID_A}}`],
    ['a uuid with trailing whitespace', `${UUID_A} `],
    ['a uuid with a newline appended', `${UUID_A}\n`],
    ['a uuid missing its last character', UUID_A.slice(0, -1)],
    ['a uuid with one character too many', `${UUID_A}a`],
    ['a uuid with the hyphens removed', UUID_A.replaceAll('-', '')],
    ['the nil uuid', '00000000-0000-0000-0000-000000000000'],
    ['a uuid with a bad variant nibble', '9f2a4c1e-1111-4111-c111-111111111111'],
    ['a constructed id from the previous build', 'youtube:abc#vero#v2'],
    ['a path traversal', '../../etc/passwd'],
    ['a uuid with a right-to-left override in it', `${UUID_A.slice(0, -1)}${char(0x202e)}`],
  ])('rejects %s', (_label, input) => {
    expect(asId(input)).toBeNull();
    expect(isUuid(input)).toBe(false);
  });

  it('accepts a lowercase v4 uuid', () => {
    expect(asId(UUID_A)).toBe(UUID_A);
  });

  /**
   * The comment on `UUID` in `ids.ts` says "UUID v4, lowercase, hyphenated",
   * and the pattern checks the VARIANT nibble (`[89ab]`) but never the VERSION
   * nibble — the third group is `[0-9a-f]{4}`, so any version passes.
   *
   * A v1 uuid encodes a MAC address and a timestamp. Everything this project
   * mints comes from `crypto.randomUUID()` and is v4, so the practical risk is
   * a lookup that misses; the defect is that the check does not enforce what
   * its own comment promises, and `asId` exists precisely for untrusted input.
   */
  it.each([
    ['v1, which encodes a MAC address and a timestamp', '9f2a4c1e-1111-1111-8111-111111111111'],
    ['v3', '9f2a4c1e-1111-3111-8111-111111111111'],
    ['v7, which encodes a timestamp', '9f2a4c1e-1111-7111-8111-111111111111'],
    ['version 0', '9f2a4c1e-1111-0111-8111-111111111111'],
  ])('rejects a uuid of the wrong version (%s)', (_label, input) => {
    expect(asId(input)).toBeNull();
  });

  // Uppercase is a different string to a case-sensitive index, so accepting
  // both spellings would make one id into two rows.
  it('rejects an uppercase uuid rather than quietly normalising it', () => {
    expect(asId(UUID_A.toUpperCase())).toBeNull();
  });

  it('accepts every id newId mints', () => {
    for (let i = 0; i < 200; i++) expect(asId(newId())).not.toBeNull();
  });

  it('mints a different id every time', () => {
    const minted = new Set(Array.from({ length: 500 }, () => String(newId())));
    expect(minted.size).toBe(500);
  });
});

describe('a room id is an allowlist, because a person types it', () => {
  it.each([
    ['a path traversal', '../..'],
    ['a leading slash', '/kitchen'],
    ['an embedded slash', 'kitchen/table'],
    ['a backslash', 'kitchen\\table'],
    ['uppercase', 'KITCHEN'],
    ['an empty string', ''],
    ['25 characters', 'a'.repeat(25)],
    ['30 characters', 'a'.repeat(30)],
    ['a leading hyphen', '-kitchen'],
    ['a space', 'kitchen table'],
    ['an embedded null byte', `kitchen${char(0)}`],
    ['a newline', 'kitchen\n'],
    ['an underscore', 'kitchen_table'],
    ['a dot', 'kitchen.table'],
    ['a percent escape', 'kitchen%2f'],
    ['a right-to-left override', `kitchen${char(0x202e)}`],
    ['a full-width letter that looks ascii', `${char(0xff4b)}itchen`],
    ['a number', 42],
    ['null', null],
    ['an object', {}],
  ])('rejects %s', (_label, input) => {
    expect(isRoomId(input)).toBe(false);
  });

  it.each([['kitchen'], ['room-1'], ['a'], ['a'.repeat(24)], ['0'], ['0-0']])(
    'accepts %s',
    (input) => {
      expect(isRoomId(input)).toBe(true);
    },
  );
});

describe('toRoomId refuses rather than sending someone to the wrong room', () => {
  it('normalises something a person plausibly typed', () => {
    expect(toRoomId('Kitchen Table!!')).toBe('kitchen-table');
  });

  it.each([
    ['a string with nothing usable in it', '!!!'],
    ['only whitespace', '   '],
    ['only punctuation', '---'],
    ['an empty string', ''],
  ])('returns null for %s rather than inventing a room', (_label, input) => {
    expect(toRoomId(input)).toBeNull();
  });

  // The guarantee that matters: whatever it hands back is something the
  // receiving side will also accept. Anything else is a room you can create and
  // never rejoin.
  it('never returns something isRoomId would reject', () => {
    const attempts = [
      'Kitchen Table', 'a'.repeat(80), '  spaced  ', 'ROOM-1', 'e!e', 'a/b/c',
      '../..', '-leading', 'trailing-', '!!!mixed???', char(0x202e) + 'room',
    ];
    for (const attempt of attempts) {
      const result = toRoomId(attempt);
      if (result !== null) expect(isRoomId(result)).toBe(true);
    }
  });
});
