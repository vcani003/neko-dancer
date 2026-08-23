/**
 * Fixtures for the engine tests.
 *
 * `ENGINEERING.md` §5: fixtures must be realistic. A test chart missing
 * `type: 'tap'` once passed a server that only counted arrows and failed the
 * client validator, so the test proved nothing about the path it claimed to
 * cover. Every chart built here is run through `validateChartRevision` by
 * `fixtures.test.ts`, so a builder that drifts out of spec fails loudly rather
 * than quietly making other tests vacuous.
 */
import { CHART_SCHEMA_VERSION, type ChartRevision, type Lane, type Note } from '@neko/protocol';

export const REVISION_ID = '9f2a4c1e-1111-4111-8111-111111111111';
export const BEATMAP_ID = '3c7d5b2f-2222-4222-9222-222222222222';

export const tap = (id: string, timeMs: number, lane: Lane = 'up'): Note => ({
  id,
  timeMs,
  lane,
  type: 'tap',
});

export const hold = (id: string, timeMs: number, durationMs: number, lane: Lane = 'up'): Note => ({
  id,
  timeMs,
  lane,
  type: 'hold',
  durationMs,
});

/**
 * A revision wrapping the given notes.
 *
 * The timing map is a single anchor at zero. ADR-003 means it never reaches the
 * engine at all — note times are already absolute — so it is present to satisfy
 * the schema and for no other reason.
 */
export function chartOf(notes: readonly Note[]): ChartRevision {
  return {
    id: REVISION_ID as ChartRevision['id'],
    beatmapId: BEATMAP_ID as ChartRevision['beatmapId'],
    schemaVersion: CHART_SCHEMA_VERSION,
    revision: 1,
    timing: [{ timeMs: 0, bpm: 120, beat: 0 }],
    notes,
    createdAtIso: '2026-01-01T00:00:00.000Z',
  };
}

/** One tap at 10,000 ms — the note most tests aim at. */
export const singleTapChart = () => chartOf([tap('n1', 10_000)]);

/**
 * A source that reports its position in coarse steps, like a real video.
 *
 * YouTube's `getCurrentTime()` moves in steps of a few hundred milliseconds.
 * This is the input that makes mean-drift correction invent lag that is not
 * there, which is why `MediaClock` corrects by minimum drift instead.
 */
export function quantised(trueTimeMs: number, stepMs: number): number {
  return Math.floor(trueTimeMs / stepMs) * stepMs;
}

/** Judgment names, worst-to-best rank, for asserting one grade is not another. */
export const GRADES = ['PERFECT', 'GREAT', 'GOOD', 'OKAY', 'MISS'] as const;
