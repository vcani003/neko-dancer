/**
 * Authoring a chart by playing along to it.
 *
 * The only route to a chart for a song whose audio we cannot read. A YouTube
 * embed gives us a clock and nothing else — no samples, so no analysis — so
 * the beats have to come from a person tapping them.
 *
 * That is not a downgrade. It is what a map editor does, and a chart tapped by
 * someone who knows the song is usually better than one a detector guesses at.
 * What the software owes them is a grid to snap to, so the result is musical
 * rather than merely accurate to their reflexes.
 *
 * Pure: times in, chart out. No audio, no DOM, no clock of its own.
 */
import { LANES, type Arrow, type Chart, type Lane } from './schema.ts';

export interface TempoFit {
  bpm: number;
  /** Milliseconds to the first beat of the grid. */
  firstBeatMs: number;
  /**
   * Typical distance from a tap to the grid it produced, in ms. Low means the
   * taps agreed with each other; high means they did not, and the fit should
   * not be trusted.
   */
  residualMs: number;
  taps: number;
}

/** Fewer than this and a fit is arithmetic rather than evidence. */
export const MIN_TAPS = 4;

/**
 * Fit a tempo grid to a series of taps.
 *
 * A least-squares line through (index, time) gives both numbers at once: the
 * slope is the beat period and the intercept is where the grid starts. Better
 * than averaging the gaps, because every tap constrains the whole line rather
 * than just its neighbour — one nervous tap early on cannot drag the tempo.
 */
export function fitTempo(tapTimesMs: readonly number[]): TempoFit | null {
  const taps = [...tapTimesMs].sort((a, b) => a - b);
  if (taps.length < MIN_TAPS) return null;

  const n = taps.length;
  const meanIndex = (n - 1) / 2;
  const meanTime = taps.reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (i - meanIndex) * (taps[i] - meanTime);
    variance += (i - meanIndex) ** 2;
  }
  if (variance === 0) return null;

  const periodMs = covariance / variance;
  if (!Number.isFinite(periodMs) || periodMs <= 0) return null;

  const firstBeatMs = meanTime - periodMs * meanIndex;

  let squaredError = 0;
  for (let i = 0; i < n; i++) {
    squaredError += (taps[i] - (firstBeatMs + periodMs * i)) ** 2;
  }

  return {
    bpm: 60_000 / periodMs,
    firstBeatMs,
    residualMs: Math.sqrt(squaredError / n),
    taps: n,
  };
}

/**
 * Halve or double a tempo into a sensible range.
 *
 * Tapping every other beat, or twice per beat, is the single easiest mistake
 * to make and produces a grid that is exactly right at the wrong scale.
 */
export function normaliseBpm(bpm: number, min = 90, max = 190): number {
  let value = bpm;
  let guard = 0;
  while (value < min && guard++ < 8) value *= 2;
  while (value > max && guard++ < 8) value /= 2;
  return value;
}

/**
 * Snap a time onto the nearest subdivision of the beat.
 *
 * Raw taps are a few tens of milliseconds scattered either side of where the
 * player meant them. Snapping makes the chart musical — and, usefully, makes
 * it identical whether it was tapped well or badly, so long as it was tapped
 * closer to the right beat than to the neighbouring one.
 *
 * @param division beats per snap point: 1 for quarter notes, 2 for eighths.
 */
export function snapToGrid(
  timeMs: number,
  bpm: number,
  firstBeatMs: number,
  division = 2,
): number {
  const stepMs = 60_000 / bpm / division;
  const steps = Math.round((timeMs - firstBeatMs) / stepMs);
  return firstBeatMs + steps * stepMs;
}

export interface RecordedTap {
  lane: Lane;
  timeMs: number;
}

export interface BuildChartOptions {
  taps: readonly RecordedTap[];
  tempo: TempoFit;
  song: Chart['song'];
  difficulty?: string;
  division?: number;
  /** Drop anything before this, so a count-in does not become notes. */
  fromMs?: number;
}

/**
 * Turn recorded taps into a chart.
 *
 * Two taps that snap to the same instant in the same lane are one note — the
 * player double-hit, or the recorder saw a key repeat. Two taps at the same
 * instant in DIFFERENT lanes are kept, because that is a chord and a real
 * thing to write.
 */
export function buildChartFromTaps(options: BuildChartOptions): Chart {
  const { taps, tempo, song, division = 2, fromMs = 0 } = options;
  const bpm = tempo.bpm;

  const seen = new Set<string>();
  const arrows: Arrow[] = [];

  for (const tap of [...taps].sort((a, b) => a.timeMs - b.timeMs)) {
    if (tap.timeMs < fromMs) continue;
    if (!LANES.includes(tap.lane)) continue;

    const timeMs = Math.max(0, Math.round(snapToGrid(tap.timeMs, bpm, tempo.firstBeatMs, division)));
    const key = `${timeMs}:${tap.lane}`;
    if (seen.has(key)) continue;
    seen.add(key);

    arrows.push({
      id: `a${(arrows.length + 1).toString().padStart(3, '0')}`,
      timeMs,
      lane: tap.lane,
      type: 'tap',
    });
  }

  arrows.sort((a, b) => a.timeMs - b.timeMs);

  return {
    schemaVersion: 1,
    song,
    analysis: {
      bpm,
      offsetMs: 0,
      // Named so a chart's provenance is obvious later: this was tapped by a
      // person, not derived from audio.
      generatorVersion: 'tapped-1',
    },
    difficulty: options.difficulty ?? 'normal',
    source: 'handmade',
    arrows,
  };
}
