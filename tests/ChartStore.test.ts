import { describe, expect, it } from 'vitest';
import { MemoryChartStore, chartKey, playbackKey } from '../src/charts/ChartStore.ts';
import type { Chart } from '../src/charts/schema.ts';

const chartFor = (playback: Chart['song']['playback']): Chart => ({
  schemaVersion: 1,
  song: { id: 's', title: 'Song', artist: 'Artist', playback },
  analysis: { bpm: 128, offsetMs: 0, generatorVersion: 'tapped-1' },
  difficulty: 'normal',
  source: 'handmade',
  arrows: [{ id: 'a001', timeMs: 1000, lane: 'left', type: 'tap' }],
});

describe('chart keys', () => {
  /** A chart belongs to the thing it was written against, not to its title. */
  it('keys a chart by its playback source', () => {
    expect(playbackKey({ provider: 'youtube', videoId: 'abc123' })).toBe('youtube:abc123');
    expect(playbackKey({ provider: 'localAudio', src: 'audio/x.mp3' })).toBe('local:audio/x.mp3');
    expect(playbackKey({ provider: 'clickTrack', bpm: 128 })).toBe('click:128');
  });

  it('gives two videos different keys', () => {
    expect(chartKey(chartFor({ provider: 'youtube', videoId: 'a' })))
      .not.toBe(chartKey(chartFor({ provider: 'youtube', videoId: 'b' })));
  });
});

describe('caching a chart', () => {
  /**
   * The whole point: a song is charted once and every play after reuses it.
   * This is what the original calls "Processing".
   */
  it('returns the same chart it stored', async () => {
    const store = new MemoryChartStore();
    const chart = chartFor({ provider: 'youtube', videoId: 'abc123' });
    await store.put(chart);

    const found = await store.get('youtube:abc123');
    expect(found?.chart.arrows).toHaveLength(1);
    expect(found?.savedAtIso).toBeTruthy();
  });

  it('has nothing for a song nobody has charted', async () => {
    expect(await new MemoryChartStore().get('youtube:unknown')).toBeNull();
  });

  it('records who authored it, when that is known', async () => {
    const store = new MemoryChartStore();
    await store.put(chartFor({ provider: 'youtube', videoId: 'v' }), 'Vero');
    expect((await store.get('youtube:v'))?.authoredBy).toBe('Vero');
  });

  it('replaces an earlier chart for the same song', async () => {
    const store = new MemoryChartStore();
    const first = chartFor({ provider: 'youtube', videoId: 'v' });
    await store.put(first);
    await store.put({
      ...first,
      arrows: [...first.arrows, { id: 'a002', timeMs: 2000, lane: 'up', type: 'tap' }],
    });
    expect((await store.get('youtube:v'))?.chart.arrows).toHaveLength(2);
    expect(await store.list()).toHaveLength(1);
  });

  /**
   * Refusing at the point of storage keeps the problem where it was created,
   * rather than surfacing it as a broken song days later.
   */
  it('refuses to store an invalid chart', async () => {
    const store = new MemoryChartStore();
    const broken = chartFor({ provider: 'youtube', videoId: 'v' });
    broken.arrows = [{ id: 'a001', timeMs: -5, lane: 'left', type: 'tap' }];
    await expect(store.put(broken)).rejects.toThrow(/Refusing to store/);
    expect(await store.get('youtube:v')).toBeNull();
  });

  it('forgets a chart on request', async () => {
    const store = new MemoryChartStore();
    await store.put(chartFor({ provider: 'youtube', videoId: 'v' }));
    await store.remove('youtube:v');
    expect(await store.get('youtube:v')).toBeNull();
  });

  /** Charts are metadata. No audio is stored, ever. */
  it('stores note times and no recording', async () => {
    const store = new MemoryChartStore();
    await store.put(chartFor({ provider: 'youtube', videoId: 'v' }));
    const serialised = JSON.stringify(await store.get('youtube:v'));
    expect(serialised).toContain('timeMs');
    expect(serialised).not.toMatch(/audio|mp3|blob:|data:/i);
  });
});
