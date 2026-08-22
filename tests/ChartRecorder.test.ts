import { describe, expect, it } from 'vitest';
import {
  MIN_TAPS,
  buildChartFromTaps,
  fitTempo,
  normaliseBpm,
  snapToGrid,
} from '../src/charts/ChartRecorder.ts';
import { validateChart } from '../src/charts/validator.ts';
import type { Chart, Lane } from '../src/charts/schema.ts';

const song: Chart['song'] = {
  id: 'test',
  title: 'Test',
  artist: 'Someone',
  playback: { provider: 'youtube', videoId: 'abc123' },
};

/** Taps on a perfect grid, for checking the fit recovers what it was given. */
const perfectTaps = (bpm: number, firstBeatMs: number, count: number) =>
  Array.from({ length: count }, (_, i) => firstBeatMs + i * (60_000 / bpm));

describe('fitTempo', () => {
  it('refuses to guess from too few taps', () => {
    expect(fitTempo([0, 500, 1000])).toBeNull();
    expect(MIN_TAPS).toBeGreaterThan(3);
  });

  it('recovers a tempo it was given exactly', () => {
    const fit = fitTempo(perfectTaps(128, 2000, 16))!;
    expect(fit.bpm).toBeCloseTo(128, 6);
    expect(fit.firstBeatMs).toBeCloseTo(2000, 6);
    expect(fit.residualMs).toBeCloseTo(0, 6);
  });

  /**
   * A least-squares line means every tap constrains the whole grid, so one
   * nervous tap early on cannot drag the tempo the way averaging gaps would.
   */
  it('survives one badly placed tap', () => {
    const taps = perfectTaps(120, 0, 16);
    taps[2] += 90;
    const fit = fitTempo(taps)!;
    expect(fit.bpm).toBeCloseTo(120, 0);
    expect(fit.residualMs).toBeGreaterThan(5);
  });

  it('reports a high residual when the taps disagree', () => {
    const scattered = [0, 480, 1080, 1420, 2100, 2380, 3050];
    expect(fitTempo(scattered)!.residualMs).toBeGreaterThan(20);
  });

  it('does not care what order the taps arrived in', () => {
    const taps = perfectTaps(140, 500, 8);
    const shuffled = [taps[3], taps[0], taps[7], taps[1], taps[5], taps[2], taps[6], taps[4]];
    expect(fitTempo(shuffled)!.bpm).toBeCloseTo(fitTempo(taps)!.bpm, 6);
  });

  it('returns null rather than nonsense for identical taps', () => {
    expect(fitTempo([1000, 1000, 1000, 1000])?.bpm).toBeUndefined();
  });
});

describe('normaliseBpm', () => {
  /** Tapping every other beat is the easiest mistake there is. */
  it('doubles a half-time tap into range', () => {
    expect(normaliseBpm(64)).toBeCloseTo(128);
  });

  it('halves a double-time tap into range', () => {
    expect(normaliseBpm(256)).toBeCloseTo(128);
  });

  it('leaves a sensible tempo alone', () => {
    expect(normaliseBpm(128)).toBeCloseTo(128);
  });
});

describe('snapToGrid', () => {
  it('pulls a sloppy tap onto the nearest beat', () => {
    // 120 BPM, beats every 500 ms, eighths every 250 ms.
    expect(snapToGrid(1012, 120, 0, 2)).toBeCloseTo(1000);
    expect(snapToGrid(1230, 120, 0, 2)).toBeCloseTo(1250);
  });

  it('respects the subdivision it was asked for', () => {
    // 120 BPM: quarters every 500 ms, eighths every 250, sixteenths every 125.
    // 1200 sits between beats, and each subdivision resolves it differently.
    expect(snapToGrid(1200, 120, 0, 1)).toBeCloseTo(1000);
    expect(snapToGrid(1200, 120, 0, 2)).toBeCloseTo(1250);
    expect(snapToGrid(1180, 120, 0, 4)).toBeCloseTo(1125);
  });

  it('snaps relative to where the grid actually starts', () => {
    expect(snapToGrid(2010, 120, 2000, 2)).toBeCloseTo(2000);
  });
});

describe('buildChartFromTaps', () => {
  const tempo = fitTempo(perfectTaps(120, 0, 16))!;
  const tap = (lane: Lane, timeMs: number) => ({ lane, timeMs });

  it('produces a valid chart', () => {
    const chart = buildChartFromTaps({
      taps: [tap('left', 1010), tap('down', 1490), tap('up', 2020)],
      tempo,
      song,
    });
    expect(validateChart(chart).errors).toEqual([]);
  });

  it('quantises every tap onto the grid', () => {
    const chart = buildChartFromTaps({
      taps: [tap('left', 1012), tap('down', 1487)],
      tempo,
      song,
    });
    expect(chart.arrows.map((a) => a.timeMs)).toEqual([1000, 1500]);
  });

  it('emits arrows in order whatever order they were tapped', () => {
    const chart = buildChartFromTaps({
      taps: [tap('up', 3000), tap('left', 1000), tap('down', 2000)],
      tempo,
      song,
    });
    expect(chart.arrows.map((a) => a.timeMs)).toEqual([1000, 2000, 3000]);
  });

  /** A double-hit is one note; two lanes at once is a chord and worth keeping. */
  it('merges two taps that land on the same beat in the same lane', () => {
    const chart = buildChartFromTaps({
      taps: [tap('left', 1005), tap('left', 1020)],
      tempo,
      song,
    });
    expect(chart.arrows).toHaveLength(1);
  });

  it('keeps two lanes tapped at the same instant', () => {
    const chart = buildChartFromTaps({
      taps: [tap('left', 1000), tap('right', 1005)],
      tempo,
      song,
    });
    expect(chart.arrows).toHaveLength(2);
    expect(chart.arrows[0].timeMs).toBe(chart.arrows[1].timeMs);
  });

  it('drops anything before the start marker, so a count-in is not notes', () => {
    const chart = buildChartFromTaps({
      taps: [tap('left', 200), tap('down', 600), tap('up', 2000)],
      tempo,
      song,
      fromMs: 1000,
    });
    expect(chart.arrows).toHaveLength(1);
  });

  it('records that a person tapped it rather than a detector finding it', () => {
    const chart = buildChartFromTaps({ taps: [tap('left', 1000)], tempo, song });
    expect(chart.analysis.generatorVersion).toBe('tapped-1');
    expect(chart.source).toBe('handmade');
  });

  it('never emits a negative time', () => {
    const chart = buildChartFromTaps({
      taps: [tap('left', 5)],
      tempo: { ...tempo, firstBeatMs: 400 },
      song,
    });
    expect(chart.arrows.every((a) => a.timeMs >= 0)).toBe(true);
  });

  it('keeps the YouTube video it was authored against', () => {
    const chart = buildChartFromTaps({ taps: [tap('left', 1000)], tempo, song });
    expect(chart.song.playback).toEqual({ provider: 'youtube', videoId: 'abc123' });
  });
});
