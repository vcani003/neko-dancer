import { describe, expect, it } from 'vitest';
import {
  analyzeSamples,
  energyEnvelope,
  estimateTempo,
  normaliseBpm,
  onsetFlux,
  pickOnsets,
} from '../src/analysis/analyze.ts';

const SAMPLE_RATE = 44_100;

/**
 * A click track with a known tempo, built from short decaying bursts.
 *
 * Synthetic audio is the only way to test a beat detector honestly: the right
 * answer is known in advance, so a regression is a failing test rather than
 * something that sounds a bit off months later.
 */
function clickTrack(bpm: number, seconds: number, offsetMs = 0): Float32Array {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  const periodSamples = (60 / bpm) * SAMPLE_RATE;
  const burst = Math.floor(SAMPLE_RATE * 0.02);

  for (let beat = 0; ; beat++) {
    const start = Math.floor((offsetMs / 1000) * SAMPLE_RATE + beat * periodSamples);
    if (start + burst >= samples.length) break;
    for (let i = 0; i < burst; i++) {
      const decay = 1 - i / burst;
      samples[start + i] = Math.sin((i / SAMPLE_RATE) * 2 * Math.PI * 200) * decay;
    }
  }
  return samples;
}

describe('energyEnvelope', () => {
  it('is silent for silence', () => {
    const envelope = energyEnvelope(new Float32Array(44_100));
    expect(envelope.every((v) => v === 0)).toBe(true);
  });

  it('rises where the audio is loud', () => {
    const samples = clickTrack(120, 2);
    const envelope = energyEnvelope(samples);
    expect(Math.max(...envelope)).toBeGreaterThan(0);
  });
});

describe('onsetFlux', () => {
  /** A held note is loud but not a beat; only increases should register. */
  it('ignores steady loudness and reacts to changes', () => {
    const steady = new Float32Array(200).fill(0.5);
    const flux = onsetFlux(steady);
    expect(Math.max(...flux)).toBeCloseTo(0, 5);
  });

  it('spikes when energy jumps', () => {
    const energies = new Float32Array(100);
    energies[50] = 1;
    const flux = onsetFlux(energies);
    expect(flux[50]).toBeGreaterThan(0);
    expect(flux[50]).toBeGreaterThan(flux[10]);
  });
});

describe('estimateTempo', () => {
  const framesPerSecond = SAMPLE_RATE / 512;

  it.each([90, 120, 128, 140, 174])('recovers %i BPM from a click track', (bpm) => {
    const flux = onsetFlux(energyEnvelope(clickTrack(bpm, 12)));
    const estimate = estimateTempo(flux, framesPerSecond)!;
    // Within one BPM: the frame grid quantises the answer slightly.
    expect(Math.abs(estimate.bpm - bpm)).toBeLessThan(1.5);
  });

  /**
   * Confidence is a z-score: how far the winning lag stands above the spread
   * of every candidate. An earlier version compared it to the MEAN, which is
   * meaningless here — mean-removed flux puts the average correlation near
   * zero, so the ratio either exploded or collapsed depending on which side of
   * zero it landed on.
   */
  it('is confident about a clean beat and unconfident about noise', () => {
    const clean = estimateTempo(onsetFlux(energyEnvelope(clickTrack(128, 12))), framesPerSecond)!;

    const noise = new Float32Array(SAMPLE_RATE * 12);
    let seed = 1;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    const noisy = estimateTempo(onsetFlux(energyEnvelope(noise)), framesPerSecond)!;

    expect(clean.confidence).toBeGreaterThan(noisy.confidence);
    expect(clean.confidence).toBeGreaterThan(1.5);
  });

  it('returns null when there is not enough audio to judge', () => {
    expect(estimateTempo(new Float32Array(4), framesPerSecond)).toBeNull();
  });
});

describe('pickOnsets', () => {
  const framesPerSecond = SAMPLE_RATE / 512;

  it('finds about one onset per beat', () => {
    const seconds = 10;
    const bpm = 120;
    const flux = onsetFlux(energyEnvelope(clickTrack(bpm, seconds)));
    const onsets = pickOnsets(flux, framesPerSecond);
    const expected = (bpm / 60) * seconds;
    expect(onsets.length).toBeGreaterThan(expected * 0.7);
    expect(onsets.length).toBeLessThan(expected * 1.4);
  });

  it('finds nothing in silence', () => {
    const flux = onsetFlux(energyEnvelope(new Float32Array(SAMPLE_RATE * 3)));
    expect(pickOnsets(flux, framesPerSecond)).toEqual([]);
  });

  /** An adaptive threshold is what keeps a quiet passage from disappearing. */
  it('still finds beats after the music gets quieter', () => {
    const loud = clickTrack(120, 6);
    const quiet = clickTrack(120, 6);
    for (let i = 0; i < quiet.length; i++) quiet[i] *= 0.1;
    const joined = new Float32Array(loud.length + quiet.length);
    joined.set(loud, 0);
    joined.set(quiet, loud.length);

    const flux = onsetFlux(energyEnvelope(joined));
    const onsets = pickOnsets(flux, framesPerSecond);
    const halfway = ((loud.length / SAMPLE_RATE) * 1000);
    const inQuietHalf = onsets.filter((f) => (f / framesPerSecond) * 1000 > halfway);
    expect(inQuietHalf.length).toBeGreaterThan(4);
  });
});

describe('normaliseBpm', () => {
  it('folds an octave error into a danceable range', () => {
    expect(normaliseBpm(64)).toBeCloseTo(128);
    expect(normaliseBpm(260)).toBeCloseTo(130);
    expect(normaliseBpm(128)).toBeCloseTo(128);
  });
});

describe('analyzeSamples', () => {
  it('reports tempo, a grid and a duration', () => {
    const analysis = analyzeSamples(clickTrack(128, 12), SAMPLE_RATE)!;
    expect(Math.abs(analysis.bpm - 128)).toBeLessThan(1.5);
    expect(analysis.durationMs).toBeCloseTo(12_000, -2);
    expect(analysis.beatsMs.length).toBeGreaterThan(20);
    expect(analysis.onsetsMs.length).toBeGreaterThan(15);
  });

  it('finds where the first beat actually is', () => {
    const analysis = analyzeSamples(clickTrack(120, 12, 250), SAMPLE_RATE)!;
    // 250 ms in, or any whole beat after — phase is only defined modulo a beat.
    const beatMs = 60_000 / analysis.bpm;
    const offsetWithinBeat = ((analysis.firstBeatMs - 250) % beatMs + beatMs) % beatMs;
    const distance = Math.min(offsetWithinBeat, beatMs - offsetWithinBeat);
    expect(distance).toBeLessThan(40);
  });

  it('puts beats on a regular grid', () => {
    const analysis = analyzeSamples(clickTrack(140, 12), SAMPLE_RATE)!;
    const gaps = analysis.beatsMs.slice(1).map((t, i) => t - analysis.beatsMs[i]);
    const expected = 60_000 / analysis.bpm;
    for (const gap of gaps) expect(Math.abs(gap - expected)).toBeLessThan(1);
  });

  it('declines rather than guessing when handed almost nothing', () => {
    expect(analyzeSamples(new Float32Array(100), SAMPLE_RATE)).toBeNull();
  });
});
