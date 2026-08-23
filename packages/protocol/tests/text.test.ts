/**
 * Text that reaches another person's screen.
 *
 * Every case here was found by attacking the first version of `sanitiseText`,
 * which began `String(value ?? '')` and truncated with `.slice()` on the joined
 * string. That coerced instead of rejecting — `{}` became `"[object Object]"`
 * and was then accepted as a title — and it cut surrogate pairs in half. This
 * group exists so neither returns.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanDisplayName,
  cleanSongMetadata,
  isHostileChar,
  MAX_CHAT_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  sanitiseText,
} from '@neko/protocol';
import { HARMLESS_CODEPOINTS, HOSTILE_CODEPOINTS, char, deeplyNested } from './helpers.ts';

describe('sanitiseText coerces nothing into a string', () => {
  it.each([
    ['an object', {}],
    ['an array', ['evil']],
    ['a number', 12345],
    ['zero', 0],
    ['a boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['a deeply nested object', deeplyNested()],
    ['an object with a toString that lies', { toString: () => 'innocent' }],
  ])('refuses %s rather than stringifying it', (_label, input) => {
    expect(sanitiseText(input, 100)).toBeNull();
  });

  it('accepts an actual string', () => {
    expect(sanitiseText('hello', 100)).toBe('hello');
  });
});

describe('sanitiseText never emits a string that cannot be stored or sent', () => {
  /**
   * Slicing the joined string is UTF-16-unit work. `'a' + emoji x12` is 25
   * units, so a 24-unit slice cut the last emoji in half and left a lone high
   * surrogate — unencodable as UTF-8, refused by Postgres, rejected by a strict
   * JSON parser.
   */
  it('does not split a surrogate pair at the length boundary', () => {
    const out = sanitiseText('a' + char(0x1f600).repeat(12), 24);
    expect(out).not.toBeNull();
    expect(out!.isWellFormed()).toBe(true);
  });

  it('survives a JSON round trip after truncation', () => {
    const out = sanitiseText('a' + char(0x1f600).repeat(12), 24);
    expect(JSON.parse(JSON.stringify(out))).toBe(out);
  });

  it('counts the limit in codepoints, not UTF-16 units', () => {
    // 12 emoji are 12 codepoints but 24 UTF-16 units. A codepoint-aware limit
    // of 12 keeps all twelve; a unit-aware one would keep six.
    expect([...sanitiseText(char(0x1f600).repeat(12), 12)!]).toHaveLength(12);
  });

  it('leaves text well-formed at every truncation length from 1 to 30', () => {
    const source = `a${char(0x1f600)}b${char(0x1f63a)}c${char(0x1f408)}d${char(0x1f3b5)}e`;
    for (let limit = 1; limit <= 30; limit++) {
      expect(sanitiseText(source, limit)!.isWellFormed()).toBe(true);
    }
  });
});

describe('invisible and directional characters cannot pass as readable text', () => {
  // A title of U+3164 renders as nothing at all. Before these were listed it
  // passed a "must contain something readable" check as readable.
  it.each(HOSTILE_CODEPOINTS)('classifies %s as hostile', (_name, code) => {
    expect(isHostileChar(code)).toBe(true);
  });

  it.each(HOSTILE_CODEPOINTS)('strips %s from between two letters', (_name, code) => {
    expect(sanitiseText(`a${char(code)}b`, 100)).toBe('ab');
  });

  it.each(HOSTILE_CODEPOINTS)('reduces a string of only %s to nothing', (_name, code) => {
    expect(sanitiseText(char(code).repeat(5), 100)).toBe('');
  });

  it.each(HARMLESS_CODEPOINTS)('leaves %s alone', (_name, code) => {
    expect(isHostileChar(code)).toBe(false);
    expect(sanitiseText(`a${char(code)}b`, 100)).toBe(`a${char(code)}b`);
  });
});

describe('display names and song metadata always yield something showable', () => {
  // These two return a string rather than null because a room has to render
  // *something*. The fallback is the server's word, never the client's — §27,
  // and ENGINEERING.md §4: the server chooses the words in anything official.
  it.each([
    ['an object', {}],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['only invisible characters', char(0x3164) + char(0x2800) + char(0x200b)],
    ['an empty string', ''],
    ['only whitespace', '   '],
  ])('falls back to a server-chosen name for %s', (_label, input) => {
    expect(cleanDisplayName(input)).toBe('neko');
  });

  it('bounds a display name so a long one cannot crowd out a scoreboard', () => {
    expect(cleanDisplayName('n'.repeat(500))).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
  });

  it('keeps a real display name intact', () => {
    expect(cleanDisplayName('  Vero  ')).toBe('Vero');
  });

  it('falls back rather than coercing non-string song metadata', () => {
    expect(cleanSongMetadata({ title: {}, artist: ['x'] })).toEqual({
      title: 'Untitled',
      artist: 'Unknown',
    });
  });

  it('bounds a song title so a 5000-character one cannot be stored', () => {
    expect(cleanSongMetadata({ title: 'a'.repeat(5000), artist: 'b' }).title)
      .toHaveLength(MAX_TITLE_LENGTH);
  });

  it('strips a right-to-left override from a display name', () => {
    // Left in, this reverses everything rendered after it, so one player's name
    // can rewrite the appearance of the whole player list.
    expect(cleanDisplayName(`Vero${char(0x202e)}evil`)).toBe('Veroevil');
  });
});

describe('the text limits are the ones both sides think they are', () => {
  // Pinned so widening one is a visible diff, never a silent change to what the
  // other side will accept.
  it('has not moved', () => {
    expect({ MAX_CHAT_LENGTH, MAX_DISPLAY_NAME_LENGTH, MAX_TITLE_LENGTH })
      .toEqual({ MAX_CHAT_LENGTH: 200, MAX_DISPLAY_NAME_LENGTH: 20, MAX_TITLE_LENGTH: 100 });
  });
});
