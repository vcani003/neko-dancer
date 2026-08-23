/**
 * `MediaClock` — API.md §1.
 *
 * The four behaviours below were "arrived at by measurement and losing them
 * would be a regression". They are the reason the original `GameClock` tracked
 * wall time exactly over a whole song with zero resyncs, and none of them is
 * obvious enough to survive a rewrite by inspection.
 *
 * The clock is fed samples and wall times (ADR-007), so every test drives it
 * with numbers and no fake player.
 */
import { describe, expect, it } from 'vitest';
import { MediaClock } from '@neko/game-core';
import { quantised } from './helpers.ts';

describe('time advances between samples instead of freezing', () => {
  /**
   * A source reports its position far more coarsely than a game reads it. If
   * the clock returned the last sample verbatim, note positions would stick and
   * then jump, and judgment would inherit that staircase as error.
   */
  it('interpolates forward from the last sample', () => {
    const clock = new MediaClock();
    clock.sample(1000, 5000);
    expect(clock.timeMs(5016)).toBeCloseTo(1016, 0);
    expect(clock.timeMs(5033)).toBeCloseTo(1033, 0);
  });

  it('advances by wall time, one millisecond for one millisecond', () => {
    const clock = new MediaClock();
    clock.sample(0, 0);
    const first = clock.timeMs(100);
    const second = clock.timeMs(200);
    expect(second - first).toBeCloseTo(100, 0);
  });

  it('does not sit still across a long gap between samples', () => {
    const clock = new MediaClock();
    clock.sample(2000, 1000);
    expect(clock.timeMs(1500)).toBeGreaterThan(2400);
  });
});

describe('a coarse source does not make the clock invent lag it does not have', () => {
  /**
   * The trap, quoted from the original: a source reporting in fixed steps makes
   * drift sawtooth between 0 and +step. The MEAN of that is +step/2 even though
   * the interpolated clock is perfectly correct — correcting toward the mean
   * introduces a lag that was never there. The MINIMUM over a window sits at
   * zero for a merely coarse source, so nothing is corrected.
   *
   * This is the test that separates the two implementations. A mean-drift clock
   * fails it by roughly half a step, which at 250 ms is 125 ms — most of a
   * judgment window, and enough to turn every PERFECT into a MISS.
   */
  it('stays accurate against a source quantised to 250 ms steps', () => {
    const clock = new MediaClock();
    const STEP = 250;
    // 30 seconds at 60 Hz: long enough for any drift-correction window to fill
    // and for a mean-drift error to accumulate to its full magnitude.
    for (let wall = 0; wall <= 30_000; wall += 16) {
      clock.sample(quantised(wall, STEP), wall);
    }
    expect(clock.timeMs(30_000)).toBeCloseTo(30_000, -1);
  });

  it('drifts by less than a PERFECT window over 30 seconds of a coarse source', () => {
    const clock = new MediaClock();
    for (let wall = 0; wall <= 30_000; wall += 16) clock.sample(quantised(wall, 250), wall);
    expect(Math.abs(clock.timeMs(30_000) - 30_000)).toBeLessThan(35);
  });

  it.each([50, 100, 250, 500])('invents no lag at a step of %i ms', (step) => {
    const clock = new MediaClock();
    for (let wall = 0; wall <= 20_000; wall += 16) clock.sample(quantised(wall, step), wall);
    // The reading must never fall behind true time by anything close to
    // step/2, which is what mean-drift correction would produce.
    expect(clock.timeMs(20_000)).toBeGreaterThan(20_000 - step / 4);
  });

  it('does correct a source it is genuinely ahead of', () => {
    /**
     * The other half of the rule. When the clock really is ahead, every drift
     * sample including the smallest carries the bias, so the minimum measures
     * it exactly and it must be removed. A clock that never corrects would pass
     * the tests above and be useless.
     */
    const clock = new MediaClock();
    const LAG = 60; // inside the resync threshold, so this is drift, not a seek
    for (let wall = 0; wall <= 30_000; wall += 16) clock.sample(wall - LAG, wall);
    expect(clock.timeMs(30_000)).toBeCloseTo(30_000 - LAG, -1);
  });
});

describe('a jump beyond the threshold is a seek, so it jumps rather than slewing', () => {
  /**
   * Slewing to a seek would take seconds to converge, and every note judged in
   * between would be judged against a position the video is not at.
   */
  it('adopts a far-away position immediately', () => {
    const clock = new MediaClock({ resyncThresholdMs: 250 });
    clock.sample(1000, 1000);
    clock.sample(60_000, 1016);
    expect(clock.timeMs(1016)).toBeCloseTo(60_000, -1);
  });

  it('adopts a backwards seek immediately', () => {
    const clock = new MediaClock({ resyncThresholdMs: 250 });
    for (let wall = 0; wall <= 5000; wall += 16) clock.sample(wall, wall);
    clock.sample(500, 5016);
    expect(clock.timeMs(5016)).toBeCloseTo(500, -1);
  });

  it('honours a custom resync threshold', () => {
    const clock = new MediaClock({ resyncThresholdMs: 10 });
    clock.sample(1000, 1000);
    clock.sample(1100, 1000);
    expect(clock.timeMs(1000)).toBeCloseTo(1100, -1);
  });

  it('treats a disagreement inside the threshold as drift, not a seek', () => {
    // A small disagreement must not cause a visible jump; it is bled off.
    const clock = new MediaClock({ resyncThresholdMs: 250 });
    clock.sample(1000, 1000);
    clock.sample(1020, 1016);
    // Somewhere between the interpolated 1016 and the sampled 1020 — but the
    // clock must not have leapt past either.
    const reading = clock.timeMs(1016);
    expect(reading).toBeGreaterThanOrEqual(1014);
    expect(reading).toBeLessThanOrEqual(1022);
  });
});

describe('a stalled source stops the clock', () => {
  /**
   * "Notes must not silently expire against a video that has stopped." This is
   * the failure that ends a round with every remaining note marked MISS while
   * the player watches a frozen frame.
   *
   * The original knew the source had stalled because it could ask the adapter
   * for its state. Under ADR-007 the clock sees only numbers, so a stall is a
   * media time that stops advancing while wall time keeps going.
   */
  it('stops advancing once the source stops advancing', () => {
    const clock = new MediaClock();
    for (let wall = 0; wall <= 2000; wall += 16) clock.sample(wall, wall);
    // The video freezes at 2000 while the wall clock runs on for two seconds.
    for (let wall = 2016; wall <= 4000; wall += 16) clock.sample(2000, wall);
    expect(clock.timeMs(4000)).toBeLessThan(2500);
  });

  it('does not run a whole judgment window past a frozen source', () => {
    const clock = new MediaClock();
    for (let wall = 0; wall <= 2000; wall += 16) clock.sample(wall, wall);
    for (let wall = 2016; wall <= 10_000; wall += 16) clock.sample(2000, wall);
    // Eight seconds of frozen video must not become eight seconds of expired notes.
    expect(clock.timeMs(10_000)).toBeLessThan(2500);
  });

  it('resumes cleanly when the source starts moving again', () => {
    const clock = new MediaClock();
    for (let wall = 0; wall <= 2000; wall += 16) clock.sample(wall, wall);
    for (let wall = 2016; wall <= 5000; wall += 16) clock.sample(2000, wall);
    for (let wall = 5016; wall <= 7000; wall += 16) clock.sample(2000 + (wall - 5000), wall);
    expect(clock.timeMs(7000)).toBeCloseTo(4000, -1);
  });
});

describe('reset forgets everything', () => {
  // Called on seek, stop, and before a new round. State surviving a reset means
  // the previous round's drift history biases the next one.
  it('does not carry drift history across a reset', () => {
    const clock = new MediaClock();
    for (let wall = 0; wall <= 5000; wall += 16) clock.sample(wall - 60, wall);
    clock.reset();
    clock.sample(0, 10_000);
    expect(clock.timeMs(10_100)).toBeCloseTo(100, 0);
  });

  it('does not carry a stall across a reset', () => {
    const clock = new MediaClock();
    for (let wall = 0; wall <= 3000; wall += 16) clock.sample(1000, wall);
    clock.reset();
    clock.sample(0, 5000);
    expect(clock.timeMs(5100)).toBeCloseTo(100, 0);
  });
});
