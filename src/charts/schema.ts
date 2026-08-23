/**
 * The chart format.
 *
 * Versioned from the first file, for the same reason hop//beat's was: charts
 * outlive the code that reads them. A chart generated today should still load
 * after the generator, the renderer and the scoring have all been rewritten,
 * and that is only possible if every file says which shape it is.
 */

export const CHART_SCHEMA_VERSION = 1;

/**
 * Four lanes, in reading order. Named rather than indexed because "lane 2" is
 * a bug waiting to happen and `down` is not.
 */
export const LANES = ['left', 'down', 'up', 'right'] as const;
export type Lane = (typeof LANES)[number];

export const LANE_INDEX: Record<Lane, number> = { left: 0, down: 1, up: 2, right: 3 };

/**
 * `tap` is all that exists today. Holds and the power-up arrows the original
 * has are named here so adding them later is not a schema change.
 */
export type ArrowType = 'tap';

export interface Arrow {
  id: string;
  /** Milliseconds from the start of the track. */
  timeMs: number;
  lane: Lane;
  type: ArrowType;
}

export type ChartSource = 'handmade' | 'generated' | 'curated';

export interface Chart {
  schemaVersion: number;
  /**
   * The song's shape, kept so a chart can be regenerated or edited later.
   *
   * Without it, an edit means charting the whole song again from scratch —
   * the arrows are the output, and the plan is the thing worth keeping.
   */
  plan?: import('./SongPlan.ts').SongPlan;
  song: {
    id: string;
    title: string;
    artist: string;
    playback:
      | { provider: 'clickTrack'; bpm: number; beatsPerBar?: number; bars?: number }
      | { provider: 'localAudio'; src: string }
      | { provider: 'youtube'; videoId: string };
  };
  analysis: {
    bpm: number;
    /** Milliseconds added to every arrow when judging. Corrects a bad first beat. */
    offsetMs: number;
    generatorVersion: string;
  };
  difficulty: string;
  source: ChartSource;
  arrows: Arrow[];
}

export function chartDurationMs(chart: Chart): number {
  return chart.arrows.length === 0 ? 0 : chart.arrows[chart.arrows.length - 1].timeMs;
}

/**
 * When this note is due, in media time. ADR-003.
 *
 * **A note time is absolute.** The chart's `analysis.offsetMs` describes the
 * beat grid the notes were authored against; it is used by the editor and by
 * analysis, and it is NEVER added to a note time at playback.
 *
 * It used to be added here. That was not producing wrong timing — every
 * generator writes `offsetMs: 0`, and both the judge and the renderer read the
 * one value this function returns, so they agreed with each other. The problem
 * was subtler and worse: `Arrow.timeMs` meant "relative to the grid" while
 * `ActiveArrow.timeMs` meant "absolute", two fields with one name and two
 * meanings, waiting for someone to use the wrong one. A chart edited by hand or
 * arriving from another build could set a non-zero offset and shift every note
 * silently.
 *
 * Kept as a function rather than inlined because it is the single place that
 * answers "when is this note", and that is worth being able to point at.
 */
export function arrowTimeMs(arrow: Arrow, _chart: Chart): number {
  return arrow.timeMs;
}
