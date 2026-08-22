import { beforeEach, describe, expect, it } from 'vitest';
import {
  LocalChartStore,
  MemoryChartStore,
  authorSlug,
  chartId,
  parseChartId,
  playbackKey,
  songKey,
} from '../src/charts/ChartStore.ts';
import type { Chart } from '../src/charts/schema.ts';

const chartFor = (playback: Chart['song']['playback'], arrows = 1): Chart => ({
  schemaVersion: 1,
  song: { id: 's', title: 'Song', artist: 'Artist', playback },
  analysis: { bpm: 128, offsetMs: 0, generatorVersion: 'tapped-1' },
  difficulty: 'normal',
  source: 'handmade',
  arrows: Array.from({ length: arrows }, (_, i) => ({
    id: `a${i}`,
    timeMs: 1000 + i * 500,
    lane: 'left' as const,
    type: 'tap' as const,
  })),
});

describe('song keys', () => {
  /** A chart belongs to the thing it was written against, not to its title. */
  it('keys a song by its playback source', () => {
    expect(playbackKey({ provider: 'youtube', videoId: 'abc123' })).toBe('youtube:abc123');
    expect(playbackKey({ provider: 'localAudio', src: 'audio/x.mp3' })).toBe('local:audio/x.mp3');
    expect(playbackKey({ provider: 'clickTrack', bpm: 128 })).toBe('click:128');
  });

  it('gives two videos different keys', () => {
    expect(songKey(chartFor({ provider: 'youtube', videoId: 'a' })))
      .not.toBe(songKey(chartFor({ provider: 'youtube', videoId: 'b' })));
  });
});

/**
 * Author names are chosen freely and end up inside an identifier — and, once
 * there is a server library, inside a filename. So this is an allowlist:
 * anything outside `[a-z0-9-]` is replaced rather than escaped.
 */
describe('author slugs', () => {
  it('reduces a name to a safe shape', () => {
    expect(authorSlug('Vero')).toBe('vero');
    expect(authorSlug('Vero Canido')).toBe('vero-canido');
  });

  it('cannot produce a path or a separator', () => {
    for (const hostile of ['../../etc/passwd', 'a/b\\c', '..', '.', 'a#b', 'a:b']) {
      const slug = authorSlug(hostile);
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug).not.toContain('/');
      expect(slug).not.toContain('\\');
      expect(slug).not.toContain('.');
      expect(slug).not.toContain('#');
    }
  });

  it('never returns an empty string', () => {
    expect(authorSlug('')).toBe('anon');
    expect(authorSlug(undefined)).toBe('anon');
    expect(authorSlug('!!!')).toBe('anon');
  });

  it('is bounded, so a name cannot become an enormous identifier', () => {
    expect(authorSlug('v'.repeat(500)).length).toBeLessThanOrEqual(24);
  });
});

describe('chart ids', () => {
  it('round-trips', () => {
    const identity = { songKey: 'youtube:kJQP7kiw5Fk', author: 'vero', version: 2 };
    const id = chartId(identity);
    expect(id).toBe('youtube:kJQP7kiw5Fk#vero#v2');
    expect(parseChartId(id)).toEqual(identity);
  });

  it('refuses anything that is not one', () => {
    for (const bad of ['', 'youtube:x', 'youtube:x#vero', 'a#b#c', 'a#b#v0', 'a#b#v-1', 'a##v1']) {
      expect(parseChartId(bad)).toBeNull();
    }
  });
});

describe('storing charts', () => {
  it('returns the same chart it stored', async () => {
    const store = new MemoryChartStore();
    const stored = await store.add(chartFor({ provider: 'youtube', videoId: 'abc123' }));

    const found = await store.get(stored.id);
    expect(found?.chart.arrows).toHaveLength(1);
    expect(found?.savedAtIso).toBeTruthy();
  });

  it('has nothing for a song nobody has charted', async () => {
    expect(await new MemoryChartStore().get('youtube:unknown#anon#v1')).toBeNull();
  });

  it('records who authored it, when that is known', async () => {
    const store = new MemoryChartStore();
    const stored = await store.add(chartFor({ provider: 'youtube', videoId: 'v' }), 'Vero');
    expect(stored.authoredBy).toBe('Vero');
    expect(stored.author).toBe('vero');
  });

  /**
   * The behaviour this replaced was the opposite: one chart per song, so a
   * re-tap silently destroyed the previous attempt. An evening of tapping
   * should not be undone by tapping again.
   */
  it('makes a re-tap the next version rather than an overwrite', async () => {
    const store = new MemoryChartStore();
    const first = await store.add(chartFor({ provider: 'youtube', videoId: 'v' }, 1), 'Vero');
    const second = await store.add(chartFor({ provider: 'youtube', videoId: 'v' }, 2), 'Vero');

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(await store.list()).toHaveLength(2);
    expect((await store.get(first.id))?.chart.arrows).toHaveLength(1);
    expect((await store.get(second.id))?.chart.arrows).toHaveLength(2);
  });

  /**
   * Two people's readings of the same song are different beatmaps, not a
   * sequence — so versions count per author. Vero's v1 and Friend's v1 coexist.
   */
  it('lets two people each chart the same song', async () => {
    const store = new MemoryChartStore();
    const mine = await store.add(chartFor({ provider: 'youtube', videoId: 'v' }), 'Vero');
    const theirs = await store.add(chartFor({ provider: 'youtube', videoId: 'v' }), 'Friend');

    expect(mine.id).not.toBe(theirs.id);
    expect(mine.version).toBe(1);
    expect(theirs.version).toBe(1);
    expect(await store.list()).toHaveLength(2);
  });

  /**
   * Refusing at the point of storage keeps the problem where it was created,
   * rather than surfacing it as a broken song days later.
   */
  it('refuses to store an invalid chart', async () => {
    const store = new MemoryChartStore();
    const broken = chartFor({ provider: 'youtube', videoId: 'v' });
    broken.arrows = [{ id: 'a001', timeMs: -5, lane: 'left', type: 'tap' }];
    await expect(store.add(broken)).rejects.toThrow(/Refusing to store/);
    expect(await store.list()).toHaveLength(0);
  });

  it('forgets a chart on request', async () => {
    const store = new MemoryChartStore();
    const stored = await store.add(chartFor({ provider: 'youtube', videoId: 'v' }));
    await store.remove(stored.id);
    expect(await store.get(stored.id)).toBeNull();
  });

  /** Charts are metadata. No audio is stored, ever. */
  it('stores note times and no recording', async () => {
    const store = new MemoryChartStore();
    const stored = await store.add(chartFor({ provider: 'youtube', videoId: 'v' }));
    const serialised = JSON.stringify(await store.get(stored.id));
    expect(serialised).toContain('timeMs');
    expect(serialised).not.toMatch(/audio|mp3|blob:|data:/i);
  });
});

/**
 * Charts saved before versions existed.
 *
 * Stored data outlives the code that wrote it. Someone who charted five songs
 * last week must still have them after an update that changed how charts are
 * identified — losing them would be a far worse bug than the one versioning
 * fixes.
 */
describe('charts stored by an older build', () => {
  beforeEach(() => {
    const entries = new Map<string, string>();
    // A minimal localStorage rather than a whole DOM: the store touches five
    // methods, and the migration is about key shapes, not about a browser.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return entries.size;
        },
        key: (i: number) => [...entries.keys()][i] ?? null,
        getItem: (k: string) => entries.get(k) ?? null,
        setItem: (k: string, v: string) => entries.set(k, v),
        removeItem: (k: string) => entries.delete(k),
        clear: () => entries.clear(),
      },
    });
  });

  const writeLegacy = (videoId: string, authoredBy?: string) => {
    localStorage.setItem(
      `neko.chart.youtube:${videoId}`,
      JSON.stringify({
        chart: chartFor({ provider: 'youtube', videoId }),
        savedAtIso: '2026-08-01T00:00:00.000Z',
        ...(authoredBy ? { authoredBy } : {}),
      }),
    );
  };

  it('reads them as version 1 rather than losing them', async () => {
    writeLegacy('old1', 'Vero');
    const listed = await new LocalChartStore().list();

    expect(listed).toHaveLength(1);
    expect(listed[0].version).toBe(1);
    expect(listed[0].author).toBe('vero');
    expect(listed[0].id).toBe('youtube:old1#vero#v1');
  });

  it('rewrites them once, so the old key does not linger', async () => {
    writeLegacy('old2', 'Vero');
    const store = new LocalChartStore();
    await store.list();

    expect(localStorage.getItem('neko.chart.youtube:old2')).toBeNull();
    expect(localStorage.getItem('neko.chart.youtube:old2#vero#v1')).toBeTruthy();
  });

  it('does not duplicate them on a second read', async () => {
    writeLegacy('old3', 'Vero');
    const store = new LocalChartStore();
    await store.list();
    expect(await store.list()).toHaveLength(1);
  });

  it('handles one that never recorded an author', async () => {
    writeLegacy('old4');
    const [record] = await new LocalChartStore().list();
    expect(record.author).toBe('anon');
    expect(record.version).toBe(1);
  });

  it('drops an entry that is no longer a valid chart', async () => {
    localStorage.setItem('neko.chart.youtube:broken', JSON.stringify({ chart: { nope: true } }));
    localStorage.setItem('neko.chart.youtube:garbage', 'not json at all');
    expect(await new LocalChartStore().list()).toHaveLength(0);
  });
});
