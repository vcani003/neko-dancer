/**
 * Tempo, from a person tapping along.
 *
 * The only route to a grid for a song whose audio we cannot read. A YouTube
 * embed gives us a clock and nothing else — no samples, so no analysis — so the
 * beats have to come from somebody tapping them.
 *
 * That is not a downgrade. It is what a map editor does, and a chart tapped by
 * someone who knows the song is usually better than one a detector guesses at.
 * What the software owes them is a grid to snap to, so the result is musical
 * rather than merely accurate to their reflexes.
 *
 * Only the tempo arithmetic lives here. Snapping, de-duplication of taps into
 * notes and everything else about building a chart are AUTHORING and stay out
 * of this package (API.md §6); they move in Phase 5.
 */

/** Fewer than this and a fit is arithmetic rather than evidence. */
export const MIN_TAPS = 4;

/**
 * How far from the grid a tap may land and still be counted, as a fraction of
 * one beat.
 *
 * A quarter of a beat. Past that the tap is nearer a neighbouring subdivision
 * than the one it was aimed at, so including it does not add evidence about
 * where the beat is — it adds a vote for a beat nobody played.
 */
const ON_GRID_BEATS = 0.25;

/**
 * The scatter at which a fit is worth nothing, as a fraction of one beat.
 *
 * An eighth of a beat: taps that loose are already landing nearer a
 * neighbouring subdivision than the one they meant, so snapping to this grid
 * would produce a chart that is confidently wrong.
 */
const WORTHLESS_RESIDUAL_BEATS = 1 / 8;

export interface TempoFit {
  bpm: number;
  /** Milliseconds to the first beat of the grid. */
  firstBeatMs: number;
  /**
   * 0–1. Two things at once, because they fail together: how closely the taps
   * that were used agreed with the grid they produced, scaled by how many of
   * the taps could be used at all. A fit built from four clean taps out of ten
   * is not a confident fit, however tidily those four line up.
   */
  confidence: number;
  /**
   * The scatter behind `confidence`: typical distance from a used tap to the
   * grid, in milliseconds. Kept alongside the normalised figure because it is
   * the measured number, and because "your taps were 12 ms apart" is something
   * a person can act on in a way that "confidence 0.81" is not.
   */
  residualMs: number;
  /** How many taps landed on the grid, out of how many were given. */
  usedTaps: number;
  totalTaps: number;
}

/** A tap, and which beat of the grid it is taken to be. */
interface Beat {
  beat: number;
  timeMs: number;
}

interface Line {
  periodMs: number;
  firstBeatMs: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] ?? Number.NaN;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function rms(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((total, v) => total + v * v, 0) / values.length);
}

/**
 * Least squares through (beat, time).
 *
 * The slope is the beat period and the intercept is where the grid starts, both
 * from one pass. Better than averaging the gaps, because every tap constrains
 * the whole line rather than just its neighbour — one nervous tap early on
 * cannot drag the tempo.
 *
 * It fits over an explicit beat NUMBER rather than over an array position. That
 * is the difference between this and the version it replaces, and it is what
 * lets a tap be missing: taps at beats 0, 1, 3, 4 describe a 120 BPM grid with
 * a gap in it, while the same four taps read as positions 0–3 describe a much
 * slower grid nobody played.
 */
function fitLine(points: readonly Beat[]): Line | null {
  const n = points.length;
  if (n < 2) return null;

  let meanBeat = 0;
  let meanTime = 0;
  for (const p of points) {
    meanBeat += p.beat;
    meanTime += p.timeMs;
  }
  meanBeat /= n;
  meanTime /= n;

  let covariance = 0;
  let variance = 0;
  for (const p of points) {
    covariance += (p.beat - meanBeat) * (p.timeMs - meanTime);
    variance += (p.beat - meanBeat) ** 2;
  }
  // Every tap on the same beat. There is no line through that.
  if (variance === 0) return null;

  const periodMs = covariance / variance;
  // Zero or negative means the taps carry no tempo at all — every tap at the
  // same instant, or times that run backwards.
  if (!Number.isFinite(periodMs) || periodMs <= 0) return null;

  return { periodMs, firstBeatMs: meanTime - periodMs * meanBeat };
}

function residualsOf(points: readonly Beat[], line: Line): number[] {
  return points.map((p) => p.timeMs - (line.firstBeatMs + line.periodMs * p.beat));
}

/**
 * Fit a tempo grid to a series of taps. Robust to human noise and to a slip.
 *
 * **This is the one place Phase 1 rewrote rather than moved**, and it is worth
 * saying why. API.md §5 calls the function robust to "one outlier" and requires
 * the Part 4 outlier fixtures to land near 120 BPM; the previous implementation
 * was a plain least-squares fit over array POSITIONS, and that cannot do it. A
 * tap 200 ms late drags the fit, a doubled tap renumbers every beat after it,
 * and a missed beat renumbers every beat after it in the other direction — the
 * three commonest things a hand does. Positions are not beats.
 *
 * So it works in three steps, each robust to a different kind of slip:
 *
 *   1. **Period from the median gap.** A doubled tap makes one gap tiny and a
 *      missed beat makes one gap double; a median ignores both, where a mean
 *      cannot.
 *   2. **Beats by rounding, phase by the median offset.** Rounding each tap to
 *      the nearest multiple of that period gives it a beat NUMBER, so a missing
 *      tap leaves a hole in the numbering instead of shifting it. The phase is
 *      re-centred on the median offset because the tap the grid is anchored to
 *      might itself be the bad one — a wildly early first tap would otherwise
 *      throw every other tap off the grid and get all of them discarded.
 *   3. **Discard what does not land on the grid, then fit what does.** A tap
 *      more than a quarter beat from its own beat is a slip, and two taps on
 *      one beat are one beat: the nearer survives.
 *
 * What it still cannot do is recover a tempo from taps that disagree with each
 * other generally. Nothing can; there is no grid in them. That case keeps every
 * tap and reports a low confidence, which is the honest answer.
 */
export function fitTempo(tapTimesMs: readonly number[]): TempoFit | null {
  const taps = [...tapTimesMs].sort((a, b) => a - b);
  if (taps.length < MIN_TAPS) return null;

  const gaps: number[] = [];
  for (let i = 1; i < taps.length; i++) gaps.push((taps[i] ?? 0) - (taps[i - 1] ?? 0));

  const periodGuessMs = median(gaps);
  // Every tap at the same instant, so there is no tempo to find. Returning a
  // number here would be an infinite BPM presented as a fact.
  if (!Number.isFinite(periodGuessMs) || periodGuessMs <= 0) return null;

  const anchorMs = taps[0] ?? 0;
  const beats = taps.map((timeMs) => Math.round((timeMs - anchorMs) / periodGuessMs));
  const offsets = taps.map((timeMs, i) => timeMs - (anchorMs + (beats[i] ?? 0) * periodGuessMs));
  const phaseMs = median(offsets);

  const toleranceMs = periodGuessMs * ON_GRID_BEATS;
  /** The tap kept for each beat, and how far off the grid it was. */
  const perBeat = new Map<number, { point: Beat; offGridMs: number }>();

  for (let i = 0; i < taps.length; i++) {
    const offGridMs = Math.abs((offsets[i] ?? 0) - phaseMs);
    if (offGridMs > toleranceMs) continue;

    const beat = beats[i] ?? 0;
    const existing = perBeat.get(beat);
    // Two taps for one beat is a double-hit or a key repeat, not a chord: the
    // one nearer the grid is the one the player meant.
    if (existing && existing.offGridMs <= offGridMs) continue;
    perBeat.set(beat, { point: { beat, timeMs: taps[i] ?? 0 }, offGridMs });
  }

  const points = [...perBeat.values()].map((kept) => kept.point).sort((a, b) => a.beat - b.beat);
  const line = fitLine(points);
  if (!line) return null;

  const residualMs = rms(residualsOf(points, line));
  const worthlessAtMs = line.periodMs * WORTHLESS_RESIDUAL_BEATS;
  const agreement = Math.min(1, Math.max(0, 1 - residualMs / worthlessAtMs));

  return {
    bpm: 60_000 / line.periodMs,
    firstBeatMs: line.firstBeatMs,
    confidence: agreement * (points.length / taps.length),
    residualMs,
    usedTaps: points.length,
    totalTaps: taps.length,
  };
}
