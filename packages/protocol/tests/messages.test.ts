/**
 * Every message that crosses the socket.
 *
 * This is the group `packages/protocol` exists for. The bug in `ENGINEERING.md`
 * §0 was a MESSAGE — `{"type":"pickSong","chart":{"arrows":[]}}`, from any
 * unauthenticated client on the network, exited the whole server — and the
 * first version of this package validated charts and nothing that crossed the
 * wire, leaving every limit in `limits.ts` bounding nothing.
 *
 * Two properties are asserted throughout:
 *   1. A malformed message is refused, never repaired.
 *   2. The value that comes back is built field by field, so nothing a client
 *      sent can ride along into a broadcast.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_LENGTH,
  MEDIA_FAILURES,
  parseClientMessage,
  type ClientMessage,
} from '@neko/protocol';
import {
  UUID_A, UUID_B, char, counts, deeplyNested, errors, progress, roundResult, value,
} from './helpers.ts';

/** Every client message type, with a minimal valid payload for each. */
const VALID: ReadonlyArray<readonly [ClientMessage['type'], Record<string, unknown>]> = [
  ['join', { type: 'join', roomId: 'kitchen' }],
  ['leave', { type: 'leave' }],
  ['chat', { type: 'chat', text: 'hi' }],
  ['queueAdd', { type: 'queueAdd', beatmapId: UUID_A }],
  ['queueRemove', { type: 'queueRemove', queueItemId: UUID_B }],
  ['ready', { type: 'ready', ready: true }],
  ['mediaResult', { type: 'mediaResult', revisionId: UUID_A, ok: true }],
  ['progress', { type: 'progress', progress: progress() }],
  ['finish', { type: 'finish', result: roundResult() }],
];

describe('every client message type parses, and only these types parse', () => {
  it.each(VALID)('accepts a well-formed %s', (type, payload) => {
    const parsed = value(parseClientMessage(payload));
    expect(parsed.type).toBe(type);
  });

  it('covers all nine types the union declares', () => {
    expect(VALID).toHaveLength(9);
  });

  it.each([
    ['the message that once killed the server', { type: 'pickSong', chart: { arrows: [] } }],
    ['an unknown type', { type: 'deleteEverything' }],
    ['an empty type', { type: '' }],
    ['a type that is a number', { type: 5 }],
    ['a type that is an object', { type: {} }],
    ['a type that is an array', { type: ['chat'] }],
    ['a missing type', { roomId: 'kitchen' }],
    ['a type differing by case', { type: 'Join', roomId: 'kitchen' }],
    ['a type with a trailing space', { type: 'join ', roomId: 'kitchen' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseClientMessage(payload).ok).toBe(false);
  });

  it.each([
    ['an array', []],
    ['a string', 'join'],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['a deeply nested object', deeplyNested()],
  ])('rejects %s as a message', (_label, input) => {
    expect(parseClientMessage(input).ok).toBe(false);
  });

  it('never throws, whatever it is handed', () => {
    // A throw inside a `ws` message handler is an uncaught exception, not an
    // error event — CLAUDE.md, and it killed the process three times.
    const hostile = [
      null, undefined, 0, '', [], {}, NaN, Infinity, deeplyNested(50_000),
      { type: 'chat' }, { type: 'join' }, { type: 'finish', result: null },
      Object.create(null), new Date(), Symbol.iterator.toString(),
    ];
    for (const input of hostile) expect(() => parseClientMessage(input)).not.toThrow();
  });
});

describe('the server never accepts an identity from a client — §27', () => {
  /**
   * "Never accept a username from the client." A client that can name itself in
   * a payload can name someone else, and a chat line that looks like it came
   * from the server looks authoritative.
   */
  it.each(VALID)('strips userId and displayName from a %s', (_type, payload) => {
    const parsed = value(parseClientMessage({
      ...payload,
      userId: UUID_A,
      displayName: 'Server',
      participantId: UUID_B,
      system: true,
    }));
    const keys = Object.keys(parsed);
    expect(keys).not.toContain('userId');
    expect(keys).not.toContain('displayName');
    expect(keys).not.toContain('participantId');
    expect(keys).not.toContain('system');
  });

  it('does not let a client mark its own chat as a system message', () => {
    const parsed = value(parseClientMessage({ type: 'chat', text: 'hi', system: true }));
    expect(Object.keys(parsed).sort()).toEqual(['text', 'type']);
  });
});

describe('join — a room id ends up in paths, so it is an allowlist', () => {
  it.each([
    ['a path traversal', '../..'],
    ['a deeper traversal', '../../../etc/passwd'],
    ['uppercase', 'KITCHEN'],
    ['30 characters', 'a'.repeat(30)],
    ['an empty string', ''],
    ['a leading hyphen', '-kitchen'],
    ['a slash', 'a/b'],
    ['a null byte', `kitchen${char(0)}`],
    ['a right-to-left override', `kitchen${char(0x202e)}`],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('rejects a join with %s as the roomId', (_label, roomId) => {
    expect(parseClientMessage({ type: 'join', roomId }).ok).toBe(false);
  });

  it('accepts a plain room name', () => {
    expect(value(parseClientMessage({ type: 'join', roomId: 'kitchen' })))
      .toEqual({ type: 'join', roomId: 'kitchen' });
  });

  // The error is deliberately vague: it must not echo what was sent, because
  // the reply is rendered and the input was hostile.
  it('does not echo the rejected room name back', () => {
    const message = errors(parseClientMessage({ type: 'join', roomId: '../../etc/passwd' })).join(' ');
    expect(message).not.toContain('etc/passwd');
  });
});

describe('chat — bounded, cleaned, and never empty', () => {
  it('trims and keeps real text', () => {
    expect(value(parseClientMessage({ type: 'chat', text: '  hello  ' })))
      .toEqual({ type: 'chat', text: 'hello' });
  });

  it(`bounds a message to ${MAX_CHAT_LENGTH} characters`, () => {
    const parsed = value(parseClientMessage({ type: 'chat', text: 'a'.repeat(5000) }));
    expect((parsed as { text: string }).text).toHaveLength(MAX_CHAT_LENGTH);
  });

  it.each([
    ['zero-width spaces', char(0x200b)],
    ['hangul fillers', char(0x3164)],
    ['braille blanks', char(0x2800)],
    ['bidi overrides', char(0x202e)],
    ['line separators', char(0x2028)],
  ])('rejects a message made entirely of %s', (_label, c) => {
    expect(parseClientMessage({ type: 'chat', text: c.repeat(10) }).ok).toBe(false);
  });

  it.each([
    ['a number', 42],
    ['an object', {}],
    ['an array', ['hi']],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['only whitespace', '     '],
  ])('rejects %s as chat text', (_label, text) => {
    expect(parseClientMessage({ type: 'chat', text }).ok).toBe(false);
  });

  it('strips a bidi override that would reverse the rest of the room log', () => {
    const parsed = value(parseClientMessage({ type: 'chat', text: `hi${char(0x202e)}there` }));
    expect((parsed as { text: string }).text).toBe('hithere');
  });
});

describe('queueAdd and queueRemove address different things — SF-1', () => {
  it('queues by beatmap id', () => {
    expect(value(parseClientMessage({ type: 'queueAdd', beatmapId: UUID_A })))
      .toEqual({ type: 'queueAdd', beatmapId: UUID_A });
  });

  /**
   * Removal is keyed on the QUEUE ENTRY, not the beatmap. Nothing forbids
   * queueing the same song twice, so `queueRemove { beatmapId }` made "remove
   * that one" ambiguous and gave no way to check that the person removing an
   * entry is the person who added it.
   */
  it('rejects a removal addressed by beatmapId, the old ambiguous shape', () => {
    expect(parseClientMessage({ type: 'queueRemove', beatmapId: UUID_A }).ok).toBe(false);
  });

  it('removes by queue entry id', () => {
    expect(value(parseClientMessage({ type: 'queueRemove', queueItemId: UUID_B })))
      .toEqual({ type: 'queueRemove', queueItemId: UUID_B });
  });

  it.each([
    ['a bare word', 'song'],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['an uppercase uuid', UUID_A.toUpperCase()],
  ])('rejects %s as a beatmapId', (_label, beatmapId) => {
    expect(parseClientMessage({ type: 'queueAdd', beatmapId }).ok).toBe(false);
  });
});

describe('ready is a boolean, and only a boolean', () => {
  it.each([[true], [false]])('accepts ready: %s', (ready) => {
    expect(value(parseClientMessage({ type: 'ready', ready }))).toEqual({ type: 'ready', ready });
  });

  it.each([
    ['the string "true"', 'true'],
    ['1', 1],
    ['0', 0],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('rejects %s as ready', (_label, ready) => {
    expect(parseClientMessage({ type: 'ready', ready }).ok).toBe(false);
  });
});

describe('mediaResult — a code from a closed set, never a sentence — §26', () => {
  it('ties the answer to the revision it is about', () => {
    // A late reply about a song the room has moved on from must not be able to
    // disqualify anyone from the current one.
    const parsed = value(parseClientMessage({ type: 'mediaResult', revisionId: UUID_A, ok: true }));
    expect((parsed as { revisionId: string }).revisionId).toBe(UUID_A);
  });

  it.each([
    ['a missing revisionId', { type: 'mediaResult', ok: true }],
    ['a non-uuid revisionId', { type: 'mediaResult', revisionId: 'rev1', ok: true }],
    ['a missing ok', { type: 'mediaResult', revisionId: UUID_A }],
    ['ok as a string', { type: 'mediaResult', revisionId: UUID_A, ok: 'yes' }],
    ['ok as a number', { type: 'mediaResult', revisionId: UUID_A, ok: 1 }],
  ])('rejects %s', (_label, payload) => {
    expect(parseClientMessage(payload).ok).toBe(false);
  });

  it.each(MEDIA_FAILURES.map((r) => [r]))('accepts the failure code %s', (reason) => {
    const parsed = value(parseClientMessage({
      type: 'mediaResult', revisionId: UUID_A, ok: false, reason,
    }));
    expect((parsed as { reason: string }).reason).toBe(reason);
  });

  /**
   * The property that matters: whatever a client sends as `reason`, what comes
   * out is a member of the closed set. `ENGINEERING.md` §4 — a client sends a
   * code, the server picks the sentence — because these render as system
   * messages, and a system message looks authoritative.
   */
  it.each([
    ['html', '<b>The host has banned you.</b>'],
    ['a sentence', 'Everyone else has left the room.'],
    ['an object', {}],
    ['a number', 42],
    ['an array', ['embedBlocked']],
    ['a near-miss of a real code', 'embedblocked'],
    ['a prototype key', '__proto__'],
  ])('never lets %s through as a failure reason', (_label, reason) => {
    const result = parseClientMessage({ type: 'mediaResult', revisionId: UUID_A, ok: false, reason });
    if (result.ok) {
      const out = (result.value as { reason?: string }).reason;
      expect(MEDIA_FAILURES).toContain(out);
    }
  });

  it('drops a reason entirely when the media loaded fine', () => {
    const parsed = value(parseClientMessage({
      type: 'mediaResult', revisionId: UUID_A, ok: true, reason: 'badId',
    }));
    expect(Object.keys(parsed)).not.toContain('reason');
  });

  it('supplies a reason when a failure was reported without one', () => {
    const parsed = value(parseClientMessage({ type: 'mediaResult', revisionId: UUID_A, ok: false }));
    expect(MEDIA_FAILURES).toContain((parsed as { reason: string }).reason);
  });
});

describe('progress and finish carry a claim, and a claim is still bounded — §25', () => {
  it('accepts a plausible run', () => {
    expect(parseClientMessage({ type: 'progress', progress: progress() }).ok).toBe(true);
  });

  it.each([
    ['a missing progress object', { type: 'progress' }],
    ['progress as a string', { type: 'progress', progress: 'good' }],
    ['progress as an array', { type: 'progress', progress: [] }],
    ['progress as null', { type: 'progress', progress: null }],
  ])('rejects %s', (_label, payload) => {
    expect(parseClientMessage(payload).ok).toBe(false);
  });

  it('accepts a complete finish', () => {
    const parsed = value(parseClientMessage({ type: 'finish', result: roundResult() }));
    expect((parsed as { result: { counts: Record<string, number> } }).result.counts.PERFECT).toBe(10);
  });

  it.each([
    ['a missing result', { type: 'finish' }],
    ['a result that is null', { type: 'finish', result: null }],
    ['a result that is an array', { type: 'finish', result: [] }],
    ['a result missing its counts', { type: 'finish', result: { ...progress(), maxCombo: 1, completed: true } }],
    ['a result missing completed', { type: 'finish', result: { ...progress(), maxCombo: 1, counts: counts() } }],
  ])('rejects %s', (_label, payload) => {
    expect(parseClientMessage(payload).ok).toBe(false);
  });
});

describe('nothing in a message can reach Object.prototype', () => {
  it('does not pollute the prototype from a __proto__ key', () => {
    parseClientMessage(JSON.parse('{"type":"leave","__proto__":{"polluted":"yes"}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not pollute the prototype through nested counts', () => {
    parseClientMessage(JSON.parse(
      '{"type":"finish","result":{"counts":{"__proto__":{"polluted":"yes"}}}}',
    ));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('parses a message on a null-prototype object', () => {
    const bare = Object.assign(Object.create(null), { type: 'leave' });
    expect(parseClientMessage(bare).ok).toBe(true);
  });
});
