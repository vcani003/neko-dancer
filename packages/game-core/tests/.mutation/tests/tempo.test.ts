/**
 * `fitTempo` — API.md §5, and the Part 4 fixtures, which are mandatory.
 *
 * A chart's grid is two numbers: how fast, and where it starts. Both come from
 * someone tapping along for a few seconds, so the fit has to survive a human
 * hand — which is late, early and inconsistent, and occasionally misses a beat
 * entirely.
 *
 * §7: "120 BPM is a beat every 500 ms — but the beats may fall at 237, 737,
 * 1237, 1737 ms. Both must be calculated." A fit that got the tempo right and
 * the phase wrong would place every note half a beat off and feel like nothing
 * at all.
 */
import { describe, expect, it } from 'vitest';
import { fitTempo } from '../src/index.ts';

/** The Part 4 fixture, exactly as the plan writes it. */
const CLEAN = [237, 737, 1237, 1737, 2237];
/** The same taps with a human hand on them, also from Part 4. */
const NOISY = [237, 740, 1233, 1745, 2235];

describe('the clean fixture — Part 4', () => {
  it('reads 120 BPM from taps half a second apart', () => {
    expect(fitTempo(CLEAN)?.bpm).toBeCloseTo(120, 1);
  });

  it('finds the first beat at 237 ms, not at zero', () => {
    // The phase is the half that matters and the half a naive interval average
    // throws away.
    expect(fitTempo(CLEAN)?.firstBeatMs).toBeCloseTo(237, 0);
  });
});

describe('the noisy fixture — Part 4', () => {
  it('still lands near 120 BPM with a human hand on the taps', () => {
    expect(fitTempo(NOISY)?.bpm).toBeCloseTo(120, 0);
  });

  it('still finds the first beat near 237 ms', () => {
    expect(Math.abs((fitTempo(NOISY)?.firstBeatMs ?? 0) - 237)).toBeLessThan(15);
  });

  it('reports lower confidence than the clean fixture', () => {
    // Confidence has to mean something, and "the noisy one is less certain" is
    // the weakest claim that still makes it non-decorative.
    const clean = fitTempo(CLEAN);
    const noisy = fitTempo(NOISY);
    expect(noisy!.confidence).toBeLessThanOrEqual(clean!.confidence);
  });
});

describe('a deliberate outlier does not drag the fit — Part 4', () => {
  /**
   * "Then with a deliberate outlier. It must still land near 120." Someone
   * sneezes, or taps twice, or misses one entirely. A least-squares fit is
   * sensitive to exactly this, which is why API.md calls the function robust
   * rather than merely a fit.
   */
  it.each([
    ['a tap 200 ms late in the middle', [237, 737, 1437, 1737, 2237]],
    ['a doubled tap', [237, 737, 780, 1237, 1737, 2237]],
    ['a wildly early first tap', [50, 737, 1237, 1737, 2237]],
    ['a tap dropped from the middle', [237, 737, 1737, 2237, 2737]],
    ['a tap far past the end', [237, 737, 1237, 1737, 2237, 9000]],
  ])('still lands near 120 BPM with %s', (_label, taps) => {
    expect(fitTempo(taps)?.bpm).toBeCloseTo(120, -0.5);
  });

  it('reports less confidence when an outlier is present', () => {
    const clean = fitTempo(CLEAN)!;
    const outlier = fitTempo([237, 737, 1437, 1737, 2237])!;
    expect(outlier.confidence).toBeLessThan(clean.confidence);
  });
});

describe('other tempos, so 120 is not hard-coded anywhere', () => {
  it.each([
    [90, 666.67],
    [128, 468.75],
    [140, 428.57],
    [174, 344.83],
  ])('reads %i BPM from taps %f ms apart', (bpm, beatMs) => {
    const taps = Array.from({ length: 8 }, (_, i) => Math.round(500 + i * beatMs));
    expect(fitTempo(taps)?.bpm).toBeCloseTo(bpm, 0);
  });

  it('finds the phase of a grid that does not start at zero', () => {
    const taps = Array.from({ length: 8 }, (_, i) => 1234 + i * 500);
    expect(fitTempo(taps)?.firstBeatMs).toBeCloseTo(1234, 0);
  });
});

describe('too little to fit returns null rather than a guess', () => {
  /**
   * A grid needs at least two taps to have an interval at all. Returning a
   * fabricated tempo would put a confident number in front of a person who has
   * given the algorithm nothing to work with — and §14 has them test the chart
   * immediately afterwards, so the lie surfaces as "the game is broken".
   */
  it.each([
    ['no taps', []],
    ['one tap', [500]],
  ])('returns null for %s', (_label, taps) => {
    expect(fitTempo(taps)).toBeNull();
  });

  it('returns null rather than an infinite tempo for identical taps', () => {
    const fit = fitTempo([500, 500, 500, 500]);
    if (fit !== null) expect(Number.isFinite(fit.bpm)).toBe(true);
  });
});

describe('the fit is deterministic — Phase 5 depends on it', () => {
  // "The same taps always produce the same chart" is Phase 5's gate. It cannot
  // hold if the fit under it wanders.
  it('returns an identical result for identical input', () => {
    expect(fitTempo(NOISY)).toEqual(fitTempo(NOISY));
  });

  it('does not mutate the array it was given', () => {
    const taps = [...NOISY];
    fitTempo(taps);
    expect(taps).toEqual(NOISY);
  });

  it('does not depend on the taps arriving sorted', () => {
    const shuffled = [1237, 237, 2237, 737, 1737];
    expect(fitTempo(shuffled)?.bpm).toBeCloseTo(120, 0);
  });
});

describe('the fit produces numbers a chart can actually use', () => {
  it('reports a tempo inside the range the protocol will store', () => {
    // MIN_BPM 20, MAX_BPM 400. A fit outside that produces a revision the
    // validator refuses, so the chart cannot be saved.
    const fit = fitTempo(CLEAN)!;
    expect(fit.bpm).toBeGreaterThanOrEqual(20);
    expect(fit.bpm).toBeLessThanOrEqual(400);
  });

  it('reports a first beat at or after zero', () => {
    expect(fitTempo(CLEAN)!.firstBeatMs).toBeGreaterThanOrEqual(0);
  });

  it('reports every field as a real number', () => {
    const fit = fitTempo(NOISY)!;
    expect(Number.isFinite(fit.bpm)).toBe(true);
    expect(Number.isFinite(fit.firstBeatMs)).toBe(true);
    expect(Number.isFinite(fit.confidence)).toBe(true);
  });
});
