/**
 * The reshape: one dump, three tables, same YouTube id is one song.
 */
import { describe, expect, it } from 'vitest';
import { importV1Dump } from '@neko/server';
import { openTestStore, tap } from './helpers.ts';

function dumpOf(
  entries: Array<{
    videoId: string;
    title: string;
    version: number;
    arrows?: number;
  }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const id = `youtube:${entry.videoId}#anon#v${entry.version}`;
    const arrows = Array.from({ length: entry.arrows ?? 1 }, (_, i) => ({
      ...tap({ id: `a${i + 1}`, timeMs: 1000 * (i + 1) }),
    }));
    out[`neko.chart.${id}`] = JSON.stringify({
      chart: {
        schemaVersion: 1,
        song: {
          id: `youtube:${entry.videoId}`,
          title: entry.title,
          artist: 'YouTube',
          playback: { provider: 'youtube', videoId: entry.videoId },
        },
        analysis: { bpm: 128, offsetMs: 0, generatorVersion: 'test' },
        plan: { durationMs: 10_000 },
        difficulty: 'normal',
        source: 'generated',
        arrows,
      },
      id,
      songKey: `youtube:${entry.videoId}`,
      author: 'anon',
      version: entry.version,
    });
  }
  return out;
}

describe('importV1Dump', () => {
  it('makes one song and two beatmaps for two versions of the same video', async () => {
    const { store } = await openTestStore();
    const result = await importV1Dump(
      store,
      dumpOf([
        { videoId: 'abc', title: 'Oh Well', version: 1 },
        { videoId: 'abc', title: 'Oh Well', version: 2 },
        { videoId: 'def', title: 'Simple and Clean', version: 1 },
      ]),
    );
    expect(result.imported).toBe(3);
    const listed = await store.listPublished();
    expect(listed.map((row) => row.title).sort()).toEqual([
      'Oh Well v1',
      'Oh Well v2',
      'Simple and Clean',
    ]);
    const songs = new Set(listed.map((row) => row.songId));
    expect(songs.size).toBe(2);
  });

  it('does not duplicate on a second run', async () => {
    const { store } = await openTestStore();
    const raw = dumpOf([{ videoId: 'abc', title: 'Oh Well', version: 1 }]);
    expect((await importV1Dump(store, raw)).imported).toBe(1);
    expect((await importV1Dump(store, raw)).imported).toBe(0);
    expect(await store.listPublished()).toHaveLength(1);
  });
});
