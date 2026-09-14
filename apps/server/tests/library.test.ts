/**
 * Phase 3 gate: Save creates a reference; Fork creates a beatmap. §17.
 *
 * If Save ever copied notes, the author's later fix would not reach the
 * saver, and Fork would look like theft. These two operations have to
 * come out as different rows.
 */
import { describe, expect, it } from 'vitest';
import { openTestStore, tap, timing } from './helpers.ts';

async function publishedChart() {
  const opened = await openTestStore();
  const author = await opened.store.createUser({ displayName: 'Author' });
  const saver = await opened.store.createUser({ displayName: 'Saver' });
  const song = await opened.store.createSong({
    provider: 'clickTrack',
    providerMediaId: 'click-lib',
    title: 'Click',
    artist: 'Metronome',
    durationMs: 15_000,
  });
  const beatmap = await opened.store.createBeatmap({
    songId: song.id,
    authorId: author.id,
    title: 'Original',
    difficulty: 'hard',
    tags: ['original'],
  });
  const revision = await opened.store.writeRevision(beatmap.id, {
    timing: timing(),
    notes: [tap()],
  });
  await opened.store.publish(beatmap.id);
  return { ...opened, author, saver, song, beatmap, revision };
}

describe('Save is a reference, Fork is a beatmap', () => {
  it('save points at the same beatmap; saving twice is one row', async () => {
    const { store, saver, beatmap } = await publishedChart();
    const first = await store.save(saver.id, beatmap.id);
    const second = await store.save(saver.id, beatmap.id);
    expect(second).toEqual(first);
    expect(first.beatmapId).toBe(beatmap.id);
    expect(await store.listLibrary(saver.id)).toHaveLength(1);
    expect((await store.getBeatmap(beatmap.id))?.authorId).not.toBe(saver.id);
  });

  it('fork creates a new beatmap with its own revision and lineage', async () => {
    const { store, saver, beatmap, revision, author } = await publishedChart();
    const saved = await store.save(saver.id, beatmap.id);
    const forked = await store.fork(beatmap.id, saver.id);

    expect(forked.beatmap.id).not.toBe(beatmap.id);
    expect(forked.beatmap.id).not.toBe(saved.beatmapId);
    expect(forked.beatmap.authorId).toBe(saver.id);
    expect(forked.beatmap.authorId).not.toBe(author.id);
    expect(forked.beatmap.forkedFromBeatmapId).toBe(beatmap.id);
    expect(forked.beatmap.forkedFromRevisionId).toBe(revision.id);
    expect(forked.beatmap.status).toBe('draft');
    expect(forked.revision.revision).toBe(1);
    expect(forked.revision.notes).toEqual(revision.notes);
    expect(forked.revision.id).not.toBe(revision.id);

    const original = await store.getRevision(revision.id);
    expect(original).toEqual(revision);
    expect((await store.getBeatmap(beatmap.id))?.authorId).toBe(author.id);
  });
});
