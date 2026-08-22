/**
 * Finding the beat in a piece of audio.
 *
 * Pure arithmetic over samples: no Web Audio, no DOM, no network. Decoding
 * happens elsewhere and hands this a mono Float32Array, which means the whole
 * thing is testable against synthetic signals whose answer is known in advance
 * — the only way to be confident a beat detector works, since checking it by
 * ear does not scale and does not regress.
 *
 * The approach is deliberately the simple one:
 *
 *   1. ENERGY ENVELOPE — how loud each short frame is.
 *   2. FLUX — how much louder than the last one. A drum hit is a spike; a held
 *      note is not, which is why flux finds beats where raw loudness does not.
 *   3. AUTOCORRELATION — the lag at which the flux best agrees with itself is
 *      the beat period.
 *   4. PHASE — slide a pulse train over the flux; the offset that collects the
 *      most energy is where the grid starts.
 *
 * This is not state-of-the-art and is not trying to be. Dance music has a loud
 * kick on the beat, which is the easiest case there is, and the project's own
 * work is turning beats into playable movement rather than reimplementing
 * onset research.
 */

/** Frames per second of analysis. One frame per ~11.6 ms at 44.1 kHz. */
export const HOP_SIZE = 512;

export const MIN_BPM = 70;
export const MAX_BPM = 200;

export interface AudioAnalysis {
  bpm: number;
  /** Milliseconds to the first beat of the grid. */
  firstBeatMs: number;
  /** Every beat on the fitted grid, in milliseconds. */
  beatsMs: number[];
  /** Detected note onsets, which are not always on beats. */
  onsetsMs: number[];
  durationMs: number;
  /**
   * How strongly the audio agreed with the winning tempo, relative to the
   * average across all candidates. Above ~1.5 is a clear answer; near 1.0
   * means the detector found nothing and is guessing.
   */
  confidence: number;
}

/** Root-mean-square loudness of each frame. */
export function energyEnvelope(samples: Float32Array, hopSize = HOP_SIZE): Float32Array {
  const frames = Math.max(0, Math.floor((samples.length - hopSize) / hopSize));
  const energies = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * hopSize;
    let sum = 0;
    for (let i = start; i < start + hopSize; i++) sum += samples[i] * samples[i];
    energies[f] = Math.sqrt(sum / hopSize);
  }
  return energies;
}

/**
 * Positive change in energy, mean-removed.
 *
 * Only increases count: a beat is a sound starting, and the decay afterwards
 * says nothing about when the next one begins. Subtracting the mean centres
 * the signal so autocorrelation measures shape rather than overall loudness.
 */
export function onsetFlux(energies: Float32Array): Float32Array {
  const flux = new Float32Array(energies.length);
  for (let i = 1; i < energies.length; i++) {
    flux[i] = Math.max(0, energies[i] - energies[i - 1]);
  }
  let mean = 0;
  for (const value of flux) mean += value;
  mean /= flux.length || 1;
  for (let i = 0; i < flux.length; i++) flux[i] -= mean;
  return flux;
}

export interface TempoEstimate {
  bpm: number;
  periodFrames: number;
  confidence: number;
}

/**
 * The lag at which the flux best agrees with itself.
 *
 * Normalised by overlap length, or long lags would be penalised simply for
 * having fewer samples to sum — which biases every naive autocorrelation
 * toward calling everything fast.
 */
export function estimateTempo(
  flux: Float32Array,
  framesPerSecond: number,
  minBpm = MIN_BPM,
  maxBpm = MAX_BPM,
): TempoEstimate | null {
  const minLag = Math.max(1, Math.floor((framesPerSecond * 60) / maxBpm));
  const maxLag = Math.min(flux.length - 1, Math.ceil((framesPerSecond * 60) / minBpm));
  if (maxLag <= minLag) return null;

  const scores = new Float64Array(maxLag - minLag + 1);
  let bestLag = minLag;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < flux.length; i++) sum += flux[i] * flux[i - lag];
    const score = sum / (flux.length - lag);
    scores[lag - minLag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Refine the peak to a fraction of a frame.
  //
  // Lags are whole frames, and at fast tempos a frame is a large slice of a
  // beat — at 174 BPM the period is only ~15 frames, so being half a frame out
  // is nearly 2 BPM. Fitting a parabola through the peak and its neighbours
  // recovers where the true maximum lies between them, which costs three
  // multiplications and removes most of the quantisation error.
  const periodFrames = refinePeak(scores, bestLag - minLag) + minLag;

  // Confidence as a z-score: how far the peak stands above the spread of all
  // candidates. A ratio against the mean was useless here — mean-removed flux
  // makes the average correlation hover around zero, so the ratio either
  // exploded or collapsed depending on which side of zero it landed.
  let sum = 0;
  for (const score of scores) sum += score;
  const mean = sum / scores.length;
  let variance = 0;
  for (const score of scores) variance += (score - mean) ** 2;
  const stdDev = Math.sqrt(variance / scores.length);

  return {
    bpm: (60 * framesPerSecond) / periodFrames,
    periodFrames,
    confidence: stdDev > 0 ? Math.max(0, (bestScore - mean) / stdDev) : 0,
  };
}

/**
 * Sub-sample peak position by parabolic interpolation.
 *
 * Three points around a maximum define a parabola, and its vertex is a better
 * estimate of the true peak than the middle sample. Standard practice wherever
 * a discrete correlation stands in for a continuous one.
 */
function refinePeak(scores: Float64Array, index: number): number {
  if (index <= 0 || index >= scores.length - 1) return index;
  const left = scores[index - 1];
  const centre = scores[index];
  const right = scores[index + 1];
  const denominator = left - 2 * centre + right;
  if (denominator === 0) return index;
  const shift = (0.5 * (left - right)) / denominator;
  // A shift beyond half a sample means the neighbours disagree about which way
  // the peak lies; trust the discrete answer instead.
  return Math.abs(shift) <= 0.5 ? index + shift : index;
}

/**
 * Where the grid starts: slide a pulse train across the flux and keep the
 * phase that collects the most energy.
 */
export function estimatePhase(flux: Float32Array, periodFrames: number): number {
  const steps = Math.max(1, Math.round(periodFrames));
  let bestPhase = 0;
  let bestScore = -Infinity;

  for (let phase = 0; phase < steps; phase++) {
    let sum = 0;
    let hits = 0;
    for (let pos = phase; pos < flux.length; pos += periodFrames) {
      sum += flux[Math.round(pos)] ?? 0;
      hits += 1;
    }
    const score = hits > 0 ? sum / hits : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  return bestPhase;
}

/**
 * Pick onsets: local maxima that clear a threshold following the music.
 *
 * A fixed threshold fails on anything with dynamics — it finds everything in
 * the loud sections and nothing in the quiet ones. A running mean over a
 * window either side adapts, so a quiet passage is judged against the quiet
 * around it.
 */
export function pickOnsets(
  flux: Float32Array,
  framesPerSecond: number,
  sensitivity = 1.4,
): number[] {
  const windowFrames = Math.max(4, Math.round(framesPerSecond * 0.25));
  const minGapFrames = Math.max(1, Math.round(framesPerSecond * 0.06));

  const onsets: number[] = [];
  let lastFrame = -Infinity;

  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue;

    const from = Math.max(0, i - windowFrames);
    const to = Math.min(flux.length, i + windowFrames);
    let sum = 0;
    for (let j = from; j < to; j++) sum += Math.abs(flux[j]);
    const local = sum / (to - from);

    if (flux[i] < local * sensitivity) continue;
    if (i - lastFrame < minGapFrames) continue;

    onsets.push(i);
    lastFrame = i;
  }

  return onsets;
}

/** Fold a tempo into a danceable range. Octave errors are routine. */
export function normaliseBpm(bpm: number, min = 90, max = 190): number {
  let value = bpm;
  let guard = 0;
  while (value < min && guard++ < 8) value *= 2;
  while (value > max && guard++ < 8) value /= 2;
  return value;
}

export interface AnalyzeOptions {
  hopSize?: number;
  minBpm?: number;
  maxBpm?: number;
  sensitivity?: number;
}

/** Analyse mono samples. Everything else in this file is a step of this. */
export function analyzeSamples(
  samples: Float32Array,
  sampleRate: number,
  options: AnalyzeOptions = {},
): AudioAnalysis | null {
  const hopSize = options.hopSize ?? HOP_SIZE;
  const framesPerSecond = sampleRate / hopSize;
  const durationMs = (samples.length / sampleRate) * 1000;

  const energies = energyEnvelope(samples, hopSize);
  if (energies.length < 16) return null;

  const flux = onsetFlux(energies);
  const tempo = estimateTempo(flux, framesPerSecond, options.minBpm, options.maxBpm);
  if (!tempo) return null;

  const phase = estimatePhase(flux, tempo.periodFrames);
  const frameToMs = (frame: number) => (frame / framesPerSecond) * 1000;

  const beatsMs: number[] = [];
  for (let pos = phase; pos < flux.length; pos += tempo.periodFrames) {
    beatsMs.push(frameToMs(pos));
  }

  return {
    bpm: tempo.bpm,
    firstBeatMs: frameToMs(phase),
    beatsMs,
    onsetsMs: pickOnsets(flux, framesPerSecond, options.sensitivity).map(frameToMs),
    durationMs,
    confidence: tempo.confidence,
  };
}
