import { describe, expect, it } from 'vitest';
import { analysisFromTempo, youTubeVideoId } from '../src/analysis/fromTempo.ts';
import { generateChart } from '../src/analysis/generate.ts';
import { validateChart } from '../src/charts/validator.ts';
import type { Chart } from '../src/charts/schema.ts';

const song: Chart['song'] = {
  id: 'yt-test',
  title: 'Test',
  artist: 'Artist',
  playback: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
};

describe('youTubeVideoId', () => {
  /** People paste whatever their browser or share sheet gave them. */
  it('reads every common form of link', () => {
    const id = 'dQw4w9WgXcQ';
    expect(youTubeVideoId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
    expect(youTubeVideoId(`https://youtube.com/watch?v=${id}&t=42s`)).toBe(id);
    expect(youTubeVideoId(`https://youtu.be/${id}`)).toBe(id);
    expect(youTubeVideoId(`https://youtu.be/${id}?t=42`)).toBe(id);
    expect(youTubeVideoId(`https://www.youtube.com/embed/${id}`)).toBe(id);
    expect(youTubeVideoId(`https://www.youtube.com/shorts/${id}`)).toBe(id);
    expect(youTubeVideoId(`https://music.youtube.com/watch?v=${id}`)).toBe(id);
    expect(youTubeVideoId(`youtube.com/watch?v=${id}`)).toBe(id);
    expect(youTubeVideoId(id)).toBe(id);
  });

  it('rejects anything that is not one', () => {
    for (const input of ['', '   ', 'not a url', 'https://example.com/watch?v=abc', 'https://youtube.com/watch?v=short']) {
      expect(youTubeVideoId(input), input).toBeNull();
    }
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(youTubeVideoId('  https://youtu.be/dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });
});

describe('analysisFromTempo', () => {
  it('lays a grid across the whole song', () => {
    const analysis = analysisFromTempo({ bpm: 120, firstBeatMs: 0, durationMs: 60_000 });
    expect(analysis.bpm).toBe(120);
    expect(analysis.beatsMs).toHaveLength(120); // 2 per second for 60 s
    expect(analysis.beatsMs[1] - analysis.beatsMs[0]).toBe(500);
  });

  /** A grid tapped from the middle of a song must still cover its start. */
  it('extends back toward zero from a late first tap', () => {
    const analysis = analysisFromTempo({ bpm: 120, firstBeatMs: 30_000, durationMs: 60_000 });
    expect(analysis.beatsMs[0]).toBeLessThan(500);
  });

  /**
   * Deliberately empty rather than faked. The generator prefers an onset near
   * a beat and falls back to the beat, so an empty list places arrows squarely
   * on the grid — right, when the grid is all anyone knows.
   */
  it('claims no onsets and no confidence, because none were measured', () => {
    const analysis = analysisFromTempo({ bpm: 128, firstBeatMs: 100, durationMs: 30_000 });
    expect(analysis.onsetsMs).toEqual([]);
    expect(analysis.confidence).toBe(0);
  });
});

describe('generating a chart from taps alone', () => {
  const grid = analysisFromTempo({ bpm: 128, firstBeatMs: 250, durationMs: 90_000 });

  it('produces a valid, playable chart with no audio involved', () => {
    const chart = generateChart(grid, { song, difficulty: 'normal' });
    expect(validateChart(chart).errors).toEqual([]);
    expect(chart.arrows.length).toBeGreaterThan(50);
    expect(chart.source).toBe('generated');
  });

  /** Same song, same chart — or it cannot be practised or compared. */
  it('is deterministic for a given song', () => {
    const a = generateChart(grid, { song });
    const b = generateChart(grid, { song });
    expect(b.arrows).toEqual(a.arrows);
  });

  it('gives different songs different charts', () => {
    const other = { ...song, id: 'different' };
    const a = generateChart(grid, { song });
    const b = generateChart(grid, { song: other });
    expect(b.arrows).not.toEqual(a.arrows);
  });

  it('thins the chart as difficulty drops', () => {
    const easy = generateChart(grid, { song, difficulty: 'easy' }).arrows.length;
    const hard = generateChart(grid, { song, difficulty: 'hard' }).arrows.length;
    expect(easy).toBeLessThan(hard);
  });

  it('leaves the opening alone so the player can settle', () => {
    const chart = generateChart(grid, { song, leadInMs: 4000 });
    expect(chart.arrows[0].timeMs).toBeGreaterThanOrEqual(4000);
  });

  it('places every arrow on the beat grid', () => {
    const chart = generateChart(grid, { song });
    const beatMs = 60_000 / 128;
    for (const arrow of chart.arrows) {
      const offset = ((arrow.timeMs - grid.firstBeatMs) % beatMs + beatMs) % beatMs;
      expect(Math.min(offset, beatMs - offset)).toBeLessThan(2);
    }
  });

  /** Playability, not accuracy, is what a generator is for. */
  it('never repeats a lane faster than a finger can', () => {
    const chart = generateChart(grid, { song, difficulty: 'normal' });
    const lastSeen = new Map<string, number>();
    for (const arrow of chart.arrows) {
      const previous = lastSeen.get(arrow.lane);
      if (previous !== undefined) {
        expect(arrow.timeMs - previous, `${arrow.lane} at ${arrow.timeMs}`).toBeGreaterThanOrEqual(300);
      }
      lastSeen.set(arrow.lane, arrow.timeMs);
    }
  });

  it('never places two arrows closer than the difficulty allows', () => {
    const chart = generateChart(grid, { song, difficulty: 'normal' });
    for (let i = 1; i < chart.arrows.length; i++) {
      expect(chart.arrows[i].timeMs - chart.arrows[i - 1].timeMs).toBeGreaterThanOrEqual(150);
    }
  });

  it('uses all four lanes', () => {
    const chart = generateChart(grid, { song, difficulty: 'hard' });
    expect(new Set(chart.arrows.map((a) => a.lane)).size).toBe(4);
  });
});
