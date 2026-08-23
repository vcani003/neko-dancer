/**
 * The three-clocks test — Part 4, proving ADR-002 and §24.
 *
 * "Three fake playback clocks starting at +0 ms, +80 ms, +150 ms. Each player
 * hits the same musical note relative to THEIR OWN playback. All three must
 * receive the same judgment. If they do not, server timing has contaminated
 * scoring."
 *
 *     server decides WHEN the round starts
 *     client media clock decides WHERE the music currently is
 *
 * The failure this prevents is the ugliest kind: nobody sees a bug, everyone
 * sees that the player with the fastest connection is somehow better at the
 * game. It is written now because it is cheap now and archaeology later.
 */
import { describe, expect, it } from 'vitest';
import { GameEngine, MediaClock } from '../src/index.ts';
import { chartOf, quantised, tap } from './helpers.ts';

/** How late this player's video actually began, in wall-clock milliseconds. */
const START_OFFSETS = [0, 80, 150] as const;
const NOTE_MS = 10_000;

/**
 * One player: a media clock fed from a video that started `offsetMs` late, and
 * an engine judging against that clock alone.
 */
function player(offsetMs: number, sourceStepMs = 0) {
  const clock = new MediaClock();
  const engine = new GameEngine({ revision: chartOf([tap('n1', NOTE_MS)]) });

  // Their video began `offsetMs` after the reference, so at wall time `w` it is
  // showing `w - offsetMs`. Feed the clock from that, coarsely if asked.
  const feed = (untilWallMs: number) => {
    for (let wall = offsetMs; wall <= untilWallMs; wall += 16) {
      const media = wall - offsetMs;
      clock.sample(sourceStepMs > 0 ? quantised(media, sourceStepMs) : media, wall);
    }
  };

  return { clock, engine, feed, offsetMs };
}

describe('three players on three differently-started videos are judged alike', () => {
  /**
   * Each player presses at the wall-clock moment their OWN video reaches the
   * note — which is a different wall time for each of them, and the same media
   * time for all of them. That is precisely the situation ADR-002 creates: the
   * countdown aligns them approximately, and their own playback decides the rest.
   */
  it('gives all three the identical judgment for a perfectly timed press', () => {
    const judgments = START_OFFSETS.map((offset) => {
      const p = player(offset);
      const pressWallMs = NOTE_MS + offset;
      p.feed(pressWallMs);
      return p.engine.press('up', p.clock.timeMs(pressWallMs))?.judgment;
    });

    expect(judgments).toEqual(['PERFECT', 'PERFECT', 'PERFECT']);
    expect(new Set(judgments).size).toBe(1);
  });

  it('gives all three the identical delta, not merely the same grade', () => {
    // A grade can hide a 30 ms discrepancy inside one window. The delta cannot.
    const deltas = START_OFFSETS.map((offset) => {
      const p = player(offset);
      const pressWallMs = NOTE_MS + offset;
      p.feed(pressWallMs);
      return p.engine.press('up', p.clock.timeMs(pressWallMs))?.deltaMs ?? NaN;
    });

    for (const delta of deltas) expect(delta).toBeCloseTo(deltas[0]!, 0);
    expect(Math.abs(deltas[0]!)).toBeLessThan(1);
  });

  it.each([
    ['40 ms early', -40, 'GREAT'],
    ['on the note', 0, 'PERFECT'],
    ['90 ms late', 90, 'GOOD'],
    ['150 ms late', 150, 'OKAY'],
  ])('agrees across all three players for a press %s', (_label, errorMs, expected) => {
    const judgments = START_OFFSETS.map((offset) => {
      const p = player(offset);
      const pressWallMs = NOTE_MS + errorMs + offset;
      p.feed(pressWallMs);
      return p.engine.press('up', p.clock.timeMs(pressWallMs))?.judgment;
    });

    expect(judgments).toEqual([expected, expected, expected]);
  });

  it('agrees even when each video reports its position coarsely', () => {
    // The realistic case: three YouTube players, each quantising to its own
    // step, each started at a different moment.
    const judgments = START_OFFSETS.map((offset, index) => {
      const p = player(offset, [100, 250, 400][index]!);
      const pressWallMs = NOTE_MS + offset;
      p.feed(pressWallMs);
      return p.engine.press('up', p.clock.timeMs(pressWallMs))?.judgment;
    });

    expect(new Set(judgments).size).toBe(1);
    expect(judgments[0]).toBe('PERFECT');
  });

  it('does not let a large start offset change anyone\'s score', () => {
    // Five seconds of stagger — far beyond anything a countdown would produce —
    // still cannot reach the judgment.
    const judgments = [0, 500, 5_000].map((offset) => {
      const p = player(offset);
      const pressWallMs = NOTE_MS + offset;
      p.feed(pressWallMs);
      return p.engine.press('up', p.clock.timeMs(pressWallMs))?.judgment;
    });

    expect(new Set(judgments).size).toBe(1);
  });
});

describe('the server clock cannot reach the judgment at all', () => {
  /**
   * The structural version of the same claim: an engine judging a press at a
   * given media time returns the same answer no matter what the wall clock
   * said, because the wall clock is not one of its inputs.
   */
  it('returns the same judgment for the same media time regardless of wall time', () => {
    const first = new GameEngine({ revision: chartOf([tap('n1', NOTE_MS)]) });
    const second = new GameEngine({ revision: chartOf([tap('n1', NOTE_MS)]) });

    const a = first.press('up', NOTE_MS + 20);
    const b = second.press('up', NOTE_MS + 20);

    expect(a?.judgment).toBe(b?.judgment);
    expect(a?.deltaMs).toBeCloseTo(b?.deltaMs ?? NaN, 10);
  });

  it('is unaffected by the order the three players are simulated in', () => {
    const run = (offsets: readonly number[]) =>
      offsets.map((offset) => {
        const p = player(offset);
        const pressWallMs = NOTE_MS + offset;
        p.feed(pressWallMs);
        return p.engine.press('up', p.clock.timeMs(pressWallMs))?.judgment;
      });

    expect(new Set([...run([0, 80, 150]), ...run([150, 80, 0])]).size).toBe(1);
  });
});
