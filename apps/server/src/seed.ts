/**
 * The playable library for MVP 1: one published chart, no authoring UI.
 *
 * `clickTrack` so nothing here reaches YouTube. A later hand-import of an
 * exported v1 chart can sit next to this without changing the shape.
 *
 * Ids are fixed so a wiped database comes back as the same library, and so
 * a test can ask for this chart by name rather than by whatever `newId()`
 * minted this run.
 */
import type { BeatmapId, RevisionId, SongId, UserId } from '@neko/protocol';
import type { PlayableChart } from '@neko/protocol';
import type { Store } from './store.ts';

export const SEED_AUTHOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UserId;
export const SEED_SONG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as SongId;
export const SEED_BEATMAP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as BeatmapId;
export const SEED_REVISION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' as RevisionId;

export async function seedLibrary(store: Store): Promise<PlayableChart> {
  const existing = await store.getPlayable(SEED_REVISION_ID);
  if (existing) return existing;

  if (!(await store.getUser(SEED_AUTHOR_ID))) {
    await store.createUser({ id: SEED_AUTHOR_ID, displayName: 'seed' });
  }
  if (!(await store.getSong(SEED_SONG_ID))) {
    await store.createSong({
      id: SEED_SONG_ID,
      provider: 'clickTrack',
      providerMediaId: 'metronome-30',
      title: 'Metronome',
      artist: 'Neko Dancer',
      durationMs: 30_000,
    });
  }
  if (!(await store.getBeatmap(SEED_BEATMAP_ID))) {
    await store.createBeatmap({
      id: SEED_BEATMAP_ID,
      songId: SEED_SONG_ID,
      authorId: SEED_AUTHOR_ID,
      title: 'Tutorial',
      difficulty: 'easy',
      tags: ['tutorial'],
    });
  }
  if (!(await store.getRevision(SEED_REVISION_ID))) {
    await store.writeRevision(SEED_BEATMAP_ID, {
      id: SEED_REVISION_ID,
      timing: [{ timeMs: 0, bpm: 120, beat: 0 }],
      notes: [
        { id: 'n1', timeMs: 1000, lane: 'left', type: 'tap' },
        { id: 'n2', timeMs: 2000, lane: 'down', type: 'tap' },
        { id: 'n3', timeMs: 3000, lane: 'up', type: 'tap' },
        { id: 'n4', timeMs: 4000, lane: 'right', type: 'tap' },
      ],
    });
  }
  await store.publish(SEED_BEATMAP_ID);

  const playable = await store.getPlayable(SEED_REVISION_ID);
  if (!playable) throw new Error('seed did not produce a playable chart');
  return playable;
}
