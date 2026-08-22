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

export function arrowTimeMs(arrow: Arrow, chart: Chart): number {
  return arrow.timeMs + chart.analysis.offsetMs;
}
