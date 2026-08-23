/**
 * Builders for valid payloads, so every test can state only its own deviation.
 *
 * A fixture that is nearly-valid by accident proves nothing: `ENGINEERING.md` §5
 * records a test chart missing `type: 'tap'` that passed a server counting
 * arrows and failed the client validator, so the test covered neither path.
 * Everything here is a *complete, accepted* payload — proven by
 * `fixtures.test.ts` — and a test expecting a rejection says which single field
 * it broke.
 *
 * Hostile characters are declared by CODEPOINT, never as literals. A literal
 * U+202E in a source file reverses the rest of the line in the editor showing
 * it, and a literal NUL is invisible in every diff tool we use.
 */
import type { Validated } from '@neko/protocol';

/** Valid UUID v4s, written out rather than generated, so failures are stable. */
export const UUID_A = '9f2a4c1e-1111-4111-8111-111111111111';
export const UUID_B = '3c7d5b2f-2222-4222-9222-222222222222';
export const UUID_C = 'a1b2c3d4-3333-4333-a333-333333333333';

export const validTiming = () => [{ timeMs: 0, bpm: 128, beat: 0 }];

export const tap = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  timeMs: 1000,
  lane: 'up',
  type: 'tap',
  ...over,
});

export const hold = (over: Record<string, unknown> = {}) => ({
  id: 'h1',
  timeMs: 1000,
  lane: 'down',
  type: 'hold',
  durationMs: 500,
  ...over,
});

export const revision = (over: Record<string, unknown> = {}) => ({
  id: UUID_A,
  beatmapId: UUID_B,
  schemaVersion: 2,
  revision: 1,
  timing: validTiming(),
  notes: [tap()],
  createdAtIso: '2026-01-01T00:00:00.000Z',
  ...over,
});

export const metadata = (over: Record<string, unknown> = {}) => ({
  difficulty: 'easy',
  status: 'draft',
  ...over,
});

export const progress = (over: Record<string, unknown> = {}) => ({
  score: 1000,
  combo: 12,
  accuracy: 0.95,
  health: 80,
  ...over,
});

export const counts = (over: Record<string, unknown> = {}) => ({
  PERFECT: 10,
  GREAT: 5,
  GOOD: 3,
  OKAY: 1,
  MISS: 2,
  ...over,
});

export const roundResult = (over: Record<string, unknown> = {}) => ({
  ...progress(),
  maxCombo: 20,
  counts: counts(),
  completed: true,
  ...over,
});

/** Unwrap a success, failing loudly with the errors if it was not one. */
export function value<T>(result: Validated<T>): T {
  if (!result.ok) throw new Error(`expected success, got: ${result.errors.join(' | ')}`);
  return result.value;
}

/** The errors of a failure, or a loud complaint that it succeeded. */
export function errors<T>(result: Validated<T>): string[] {
  if (result.ok) throw new Error('expected a rejection, got a success');
  return result.errors;
}

// --------------------------------------------------------- hostile strings ----

/**
 * Characters that are invisible, directional, or otherwise not what they look
 * like — by name and codepoint, because `'؜'` in an assertion message
 * tells nobody what went wrong.
 */
export const HOSTILE_CODEPOINTS: ReadonlyArray<readonly [string, number]> = [
  ['U+0000 NUL', 0x0000],
  ['U+0009 TAB', 0x0009],
  ['U+000A LINE FEED', 0x000a],
  ['U+001B ESCAPE', 0x001b],
  ['U+007F DELETE', 0x007f],
  ['U+0085 C1 NEXT LINE', 0x0085],
  ['U+009B C1 CSI', 0x009b],
  ['U+00AD SOFT HYPHEN', 0x00ad],
  ['U+061C ARABIC LETTER MARK', 0x061c],
  ['U+200B ZERO WIDTH SPACE', 0x200b],
  ['U+200D ZERO WIDTH JOINER', 0x200d],
  ['U+200E LEFT-TO-RIGHT MARK', 0x200e],
  ['U+2028 LINE SEPARATOR', 0x2028],
  ['U+2029 PARAGRAPH SEPARATOR', 0x2029],
  ['U+202E RIGHT-TO-LEFT OVERRIDE', 0x202e],
  ['U+2066 LEFT-TO-RIGHT ISOLATE', 0x2066],
  ['U+2069 POP DIRECTIONAL ISOLATE', 0x2069],
  ['U+2800 BRAILLE PATTERN BLANK', 0x2800],
  ['U+3164 HANGUL FILLER', 0x3164],
  ['U+FEFF ZERO WIDTH NO-BREAK SPACE', 0xfeff],
];

/** Characters that must survive: real text people legitimately write. */
export const HARMLESS_CODEPOINTS: ReadonlyArray<readonly [string, number]> = [
  ['a latin letter', 0x0061],
  ['a space', 0x0020],
  ['an accented letter', 0x00e9],
  ['a cyrillic letter', 0x0434],
  ['an arabic letter', 0x0627],
  ['a hiragana', 0x3042],
  ['a CJK ideograph', 0x4e00],
  ['an em dash', 0x2014],
  ['a musical note sign', 0x266a],
  ['an emoji', 0x1f600],
];

export const char = (codepoint: number): string => String.fromCodePoint(codepoint);

/** An object nested `depth` deep, for proving no validator recurses into one. */
export function deeplyNested(depth = 20_000): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (let i = 0; i < depth; i++) {
    const next: Record<string, unknown> = {};
    cursor.nested = next;
    cursor = next;
  }
  return root;
}
