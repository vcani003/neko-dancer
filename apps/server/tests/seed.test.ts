/**
 * MVP 1 plays seeded charts. This is the one the play loop will load.
 */
import { describe, expect, it } from 'vitest';
import { SEED_BEATMAP_ID, SEED_REVISION_ID, seedLibrary } from '@neko/server';
import { openTestStore } from './helpers.ts';

describe('seedLibrary', () => {
  it('publishes a click-track chart that listPublished can see', async () => {
    const { store } = await openTestStore();
    const playable = await seedLibrary(store);
    expect(playable.revision.id).toBe(SEED_REVISION_ID);
    expect(playable.beatmap.id).toBe(SEED_BEATMAP_ID);
    expect(playable.beatmap.status).toBe('published');
    expect(playable.song.provider).toBe('clickTrack');
    expect(playable.revision.notes.length).toBe(4);

    const listed = await store.listPublished();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.revisionId).toBe(SEED_REVISION_ID);
    expect(listed[0]?.title).toBe('Tutorial');
  });

  it('is idempotent — seeding twice is the same chart', async () => {
    const { store } = await openTestStore();
    const first = await seedLibrary(store);
    const second = await seedLibrary(store);
    expect(second).toEqual(first);
    expect(await store.listPublished()).toHaveLength(1);
  });
});
