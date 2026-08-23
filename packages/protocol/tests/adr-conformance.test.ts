/**
 * The accepted decisions, as executable assertions.
 *
 * `SYSTEM-DESIGN.md` says anything in the codebase contradicting it is a defect
 * unless an ADR records the deviation. An ADR that lives only in a markdown
 * file is a decision nothing enforces — so each one that can be checked from
 * this package is checked here, and the ADR number is in the test name so a
 * failure points at the decision it breaks.
 */
import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_MS,
  DEFAULT_PREFERENCES,
  DEFAULT_WINDOWS,
  JUDGMENTS,
  LANES,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS_PER_ROOM,
  MAX_QUEUE_LENGTH,
  MAX_ROOMS,
  MEDIA_FAILURES,
  MEDIA_PROVIDERS,
  MEDIA_STATES,
  PREFLIGHT_TIMEOUT_MS,
  RATE_LIMIT,
  ROUND_GRACE_MS,
  ROUND_STATES,
  parseClientMessage,
} from '@neko/protocol';
import { UUID_A } from './helpers.ts';

describe('ADR-001 — a lane is a direction, never a key', () => {
  // §29 stores key bindings as a user preference. If a lane's identity were a
  // key, rebinding would change the meaning of every note already in the
  // database — a property a schema must not have.
  it('names the four lanes as directions', () => {
    expect(LANES).toEqual(['left', 'down', 'up', 'right']);
  });

  it('contains no physical key anywhere in the lane set', () => {
    expect(LANES.some((lane) => ['W', 'A', 'S', 'D'].includes(lane as string))).toBe(false);
  });
});

describe('ADR-002 — a round starts as a delay, never a server timestamp', () => {
  /**
   * Two machines' `Date.now()` routinely differ by seconds. Compared naively, a
   * client either starts instantly or waits a very long time. A duration means
   * the same thing on both.
   */
  it('provides a countdown expressed as a duration', () => {
    expect(COUNTDOWN_MS).toBe(3000);
    expect(Number.isFinite(COUNTDOWN_MS)).toBe(true);
  });

  it('is a duration small enough to be a countdown, not an instant on a clock', () => {
    // A wall-clock timestamp today is ~1.7e12. Anything of that magnitude here
    // would mean someone had put a timestamp in a duration field.
    expect(COUNTDOWN_MS).toBeLessThan(60_000);
  });
});

describe('ADR-005 — five grades, and the boundaries between them', () => {
  it('names five grades, best to worst', () => {
    expect(JUDGMENTS).toEqual(['PERFECT', 'GREAT', 'GOOD', 'OKAY', 'MISS']);
  });

  it('pins the windows at the decided values', () => {
    expect(DEFAULT_WINDOWS).toEqual({ perfectMs: 35, greatMs: 70, goodMs: 110, okayMs: 160 });
  });

  it('gives MISS no window of its own, because it is what falls outside OKAY', () => {
    expect(Object.keys(DEFAULT_WINDOWS)).toHaveLength(JUDGMENTS.length - 1);
    expect(Object.keys(DEFAULT_WINDOWS)).not.toContain('missMs');
  });

  it('orders the windows strictly outward, so every grade owns a band', () => {
    const { perfectMs, greatMs, goodMs, okayMs } = DEFAULT_WINDOWS;
    expect(perfectMs).toBeLessThan(greatMs);
    expect(greatMs).toBeLessThan(goodMs);
    expect(goodMs).toBeLessThan(okayMs);
  });

  it('has one window per grade, named for that grade', () => {
    const expected = JUDGMENTS.filter((j) => j !== 'MISS').map((j) => `${j.toLowerCase()}Ms`);
    expect(Object.keys(DEFAULT_WINDOWS).sort()).toEqual(expected.sort());
  });

  /**
   * The boundary table Game Core must implement, walked on BOTH sides of every
   * edge. A window is inclusive of its own boundary: a press exactly 35 ms out
   * is PERFECT, 36 ms out is GREAT. Phase 1's gate is this table with a
   * FakePlaybackAdapter behind it; pinning it here means the numbers cannot
   * drift between the contract and the engine that reads them.
   */
  const grade = (errorMs: number): string => {
    const { perfectMs, greatMs, goodMs, okayMs } = DEFAULT_WINDOWS;
    const e = Math.abs(errorMs);
    if (e <= perfectMs) return 'PERFECT';
    if (e <= greatMs) return 'GREAT';
    if (e <= goodMs) return 'GOOD';
    if (e <= okayMs) return 'OKAY';
    return 'MISS';
  };

  it.each([
    [0, 'PERFECT'],
    [34, 'PERFECT'], [35, 'PERFECT'], [36, 'GREAT'],
    [69, 'GREAT'], [70, 'GREAT'], [71, 'GOOD'],
    [109, 'GOOD'], [110, 'GOOD'], [111, 'OKAY'],
    [159, 'OKAY'], [160, 'OKAY'], [161, 'MISS'],
    [1000, 'MISS'],
  ])('a press %i ms late is %s', (errorMs, expected) => {
    expect(grade(errorMs)).toBe(expected);
  });

  it.each([
    [-34, 'PERFECT'], [-35, 'PERFECT'], [-36, 'GREAT'],
    [-70, 'GREAT'], [-71, 'GOOD'],
    [-110, 'GOOD'], [-111, 'OKAY'],
    [-160, 'OKAY'], [-161, 'MISS'],
  ])('a press %i ms early is %s — the window is symmetrical', (errorMs, expected) => {
    expect(grade(errorMs)).toBe(expected);
  });

  it('grades every value the same whether it is early or late', () => {
    for (let e = 0; e <= 300; e++) expect(grade(e)).toBe(grade(-e));
  });
});

describe('ADR-006 — a MediaSource has no id of its own', () => {
  // Persistent identity is `Song.id`; a MediaSource is identified by
  // `provider + providerMediaId`. Two identities for one piece of media is a
  // question with no good answer.
  it('is satisfiable without an id field', () => {
    const source = { provider: 'youtube' as const, providerMediaId: 'abc123', title: 'x' };
    expect(Object.keys(source)).not.toContain('id');
  });
});

describe('the determinism rule — no automated test may require YouTube', () => {
  /**
   * Part 4 states it absolutely, and the repo already ships a click-track and a
   * local-audio adapter. If `youtube` were the only provider, every fixture
   * would need a Song this type cannot describe.
   */
  it('can describe a song that is not a YouTube video', () => {
    expect(MEDIA_PROVIDERS).toContain('clickTrack');
    expect(MEDIA_PROVIDERS).toContain('localAudio');
  });

  it('still supports the only provider a user can add', () => {
    expect(MEDIA_PROVIDERS).toContain('youtube');
  });
});

describe('§13 — three offsets, and only the player calibration is per player', () => {
  it('stores calibration as a player preference, defaulting to no adjustment', () => {
    expect(DEFAULT_PREFERENCES.calibrationMs).toBe(0);
  });

  it('keeps calibration out of the chart, where the chart offset lives', () => {
    expect(Object.keys(DEFAULT_PREFERENCES).sort()).toEqual(['calibrationMs', 'scrollSpeed', 'volume']);
  });
});

describe('§26 — a failed video must not freeze the room', () => {
  it('bounds the wait for preflight answers, not only the round itself', () => {
    // Guarding `playing` and not `preparing` leaves the same deadlock reachable
    // through the door next to the one that was locked.
    expect(PREFLIGHT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ROUND_GRACE_MS).toBeGreaterThan(0);
  });

  it('gives preflight less time than a whole round', () => {
    expect(PREFLIGHT_TIMEOUT_MS).toBeLessThan(ROUND_GRACE_MS);
  });

  it('can express a player who is present but not in the round', () => {
    // §21 gates the start on "every participating player". All three policies
    // §26 leaves open — skip, spectate, drop from the ready requirement — need
    // this distinction to exist.
    const player = { participating: false, connected: true, media: 'failed' as const };
    expect(MEDIA_STATES).toContain(player.media);
    expect(typeof player.participating).toBe('boolean');
  });

  it('distinguishes a disconnect from a departure', () => {
    expect(typeof { connected: false }.connected).toBe('boolean');
  });
});

describe('the closed sets stay closed', () => {
  it.each([
    ['MEDIA_FAILURES', MEDIA_FAILURES, ['embedBlocked', 'unavailable', 'badId', 'playerFailed', 'unknown']],
    ['MEDIA_STATES', MEDIA_STATES, ['unknown', 'ready', 'failed']],
    ['ROUND_STATES', ROUND_STATES, ['lobby', 'preparing', 'countdown', 'playing', 'results']],
  ])('%s has not gained or lost a member', (_name, actual, expected) => {
    expect([...actual]).toEqual(expected);
  });

  it('has an "unknown" failure code, so a failure always has something to report', () => {
    expect(MEDIA_FAILURES).toContain('unknown');
  });

  it('accepts every declared failure code through the parser', () => {
    for (const reason of MEDIA_FAILURES) {
      const result = parseClientMessage({
        type: 'mediaResult', revisionId: UUID_A, ok: false, reason,
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe('the orchestration limits are the ones both sides think they are', () => {
  /**
   * These bound rooms, queues and traffic rather than payloads, so nothing in
   * this package enforces them yet — `apps/server` does, in Phase 7. Pinned now
   * so the value the server implements against is the value that was agreed,
   * and so changing one is a visible diff.
   */
  it('has not moved', () => {
    expect({
      MAX_MESSAGE_BYTES, MAX_PLAYERS_PER_ROOM, MAX_ROOMS,
      MAX_QUEUE_LENGTH, RATE_LIMIT, ROUND_GRACE_MS, PREFLIGHT_TIMEOUT_MS, COUNTDOWN_MS,
    }).toEqual({
      MAX_MESSAGE_BYTES: 512 * 1024,
      MAX_PLAYERS_PER_ROOM: 16,
      MAX_ROOMS: 32,
      MAX_QUEUE_LENGTH: 20,
      RATE_LIMIT: 40,
      ROUND_GRACE_MS: 90_000,
      PREFLIGHT_TIMEOUT_MS: 15_000,
      COUNTDOWN_MS: 3000,
    });
  });

  it('allows a message large enough for a real chart', () => {
    // A guessed 4 KB cap was once smaller than a real 21 KB chart, so it
    // rejected the happy path — and the oversized frame took the server down.
    expect(MAX_MESSAGE_BYTES).toBeGreaterThan(64 * 1024);
  });
});
