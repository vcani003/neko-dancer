/**
 * Timing judgment across four lanes.
 *
 * Five tiers rather than hop//beat's three, matching the original: Perfect,
 * Nice, Okay, Oops, Miss. The extra grain is worth having here in a way it was
 * not there — a keypress lands where the player meant it to, so the difference
 * between 30 ms and 70 ms is a real thing they did, not noise from a camera.
 *
 * Pure and clock-free: it is told the playback time an input happened at, and
 * answers what it was worth.
 */
import type { Arrow, Chart, Lane } from '../charts/schema.ts';
import { arrowTimeMs } from '../charts/schema.ts';

export type Judgment = 'PERFECT' | 'GREAT' | 'GOOD' | 'OKAY' | 'MISS';

/** Ordered best to worst, for anything that needs to rank them. */
export const JUDGMENTS: readonly Judgment[] = ['PERFECT', 'GREAT', 'GOOD', 'OKAY', 'MISS'];

export interface TimingWindows {
  perfectMs: number;
  greatMs: number;
  goodMs: number;
  okayMs: number;
}

/**
 * Starting values, tunable.
 *
 * Far tighter than hop//beat's ±80/±160, and they can be: a keydown carries no
 * inference latency, so none of the window is spent before the input is seen.
 * That measured ~28 ms of camera pipeline is simply not here to pay for.
 */
export const DEFAULT_WINDOWS: TimingWindows = {
  perfectMs: 35,
  greatMs: 70,
  goodMs: 110,
  okayMs: 160,
};

export interface ActiveArrow {
  arrow: Arrow;
  /** Arrow time with the chart's offset applied. */
  timeMs: number;
  judgment: Judgment | null;
  /** Signed error: negative early, positive late. */
  deltaMs: number | null;
}

export function toActiveArrows(chart: Chart): ActiveArrow[] {
  return chart.arrows.map((arrow) => ({
    arrow,
    timeMs: arrowTimeMs(arrow, chart),
    judgment: null,
    deltaMs: null,
  }));
}

export function judgeDelta(
  absDeltaMs: number,
  windows: TimingWindows = DEFAULT_WINDOWS,
): Judgment {
  if (absDeltaMs <= windows.perfectMs) return 'PERFECT';
  if (absDeltaMs <= windows.greatMs) return 'GREAT';
  if (absDeltaMs <= windows.goodMs) return 'GOOD';
  if (absDeltaMs <= windows.okayMs) return 'OKAY';
  return 'MISS';
}

/**
 * The arrow a keypress should be credited against: nearest in time, in that
 * lane, still unjudged, still inside the widest window.
 *
 * Nearest rather than earliest matters when two arrows sit close together in
 * one lane — crediting the earlier one consumes the arrow the player was not
 * aiming at and leaves the intended one to expire.
 */
export function findClaimableArrow(
  arrows: readonly ActiveArrow[],
  lane: Lane,
  playbackTimeMs: number,
  windows: TimingWindows = DEFAULT_WINDOWS,
): ActiveArrow | null {
  let best: ActiveArrow | null = null;
  let bestDelta = Infinity;

  for (const active of arrows) {
    if (active.judgment !== null) continue;
    if (active.arrow.lane !== lane) continue;
    const delta = Math.abs(playbackTimeMs - active.timeMs);
    if (delta > windows.okayMs) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = active;
    }
  }

  return best;
}

/**
 * Arrows whose window has fully closed unjudged.
 *
 * Only missed once the player can no longer reach them — marking earlier would
 * steal presses they were still entitled to make.
 */
export function collectExpiredArrows(
  arrows: readonly ActiveArrow[],
  playbackTimeMs: number,
  windows: TimingWindows = DEFAULT_WINDOWS,
): ActiveArrow[] {
  return arrows.filter(
    (active) => active.judgment === null && playbackTimeMs > active.timeMs + windows.okayMs,
  );
}

/** Arrows currently on screen: approaching, or just past the receptor. */
export function visibleArrows(
  arrows: readonly ActiveArrow[],
  playbackTimeMs: number,
  leadMs: number,
  trailMs = 150,
): ActiveArrow[] {
  return arrows.filter((a) => {
    const remaining = a.timeMs - playbackTimeMs;
    return remaining <= leadMs && remaining >= -trailMs;
  });
}
