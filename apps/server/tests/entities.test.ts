/**
 * Phase 3 gate: a round-trip per stored entity.
 *
 * What goes in is what comes out, validated, with the ids the protocol
 * branded. If a mapper starts returning the raw row, or a write drops a
 * field, these fail before a play loop can depend on the lie.
 */
import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '@neko/server';
import { NOW, aRound, openTestStore, tap, timing } from './helpers.ts';

async function world() {
  const opened = await openTestStore();
  const author = await opened.store.createUser({ displayName: 'Vero' });
  const song = await opened.store.createSong({
    provider: 'clickTrack',
    providerMediaId: 'click-1',
    title: 'Click',
    artist: 'Metronome',
    durationMs: 15_000,
  });
  const beatmap = await opened.store.createBeatmap({
    songId: song.id,
    authorId: author.id,
    title: 'Easy',
    difficulty: 'easy',
    tags: ['tutorial'],
  });
  const revision = await opened.store.writeRevision(beatmap.id, {
    timing: timing(),
    notes: [tap()],
  });
  const storedBeatmap = await opened.store.getBeatmap(beatmap.id);
  if (!storedBeatmap) throw new Error('beatmap vanished');
  return { ...opened, author, song, beatmap: storedBeatmap, revision };
}

describe('round-trip', () => {
  it('stores a user and gives the same person back', async () => {
    const { store } = await openTestStore();
    const user = await store.createUser({ displayName: 'Vero' });
    expect(user.displayName).toBe('Vero');
    expect(user.createdAtIso).toBe(NOW);
    expect(await store.getUser(user.id)).toEqual(user);
  });

  it('stores a song and looks it up by id and by media', async () => {
    const { store, song } = await world();
    expect(song.provider).toBe('clickTrack');
    expect(song.title).toBe('Click');
    expect(await store.getSong(song.id)).toEqual(song);
    expect(await store.findSongByMedia('clickTrack', 'click-1')).toEqual(song);
  });

  it('stores a beatmap as a draft pointing at its song and author', async () => {
    const { store, song, author, beatmap, revision } = await world();
    expect(beatmap.songId).toBe(song.id);
    expect(beatmap.authorId).toBe(author.id);
    expect(beatmap.status).toBe('draft');
    expect(beatmap.currentRevisionId).toBe(revision.id);
    expect(beatmap.tags).toEqual(['tutorial']);
    expect(await store.getBeatmap(beatmap.id)).toEqual(beatmap);
  });

  it('stores a chart revision and reads it back byte-identical', async () => {
    const { store, revision } = await world();
    expect(await store.getRevision(revision.id)).toEqual(revision);
    expect(revision.schemaVersion).toBe(2);
    expect(revision.revision).toBe(1);
    expect(revision.notes).toEqual([tap()]);
  });

  it('stores a library entry as a reference, not a copy', async () => {
    const { store, author, beatmap } = await world();
    const entry = await store.save(author.id, beatmap.id);
    expect(entry.userId).toBe(author.id);
    expect(entry.beatmapId).toBe(beatmap.id);
    expect(entry.savedAtIso).toBe(NOW);
    expect(await store.listLibrary(author.id)).toEqual([entry]);
    expect(await store.getBeatmap(beatmap.id)).toMatchObject({ id: beatmap.id });
  });

  it('stores a self-reported score against a revision', async () => {
    const { store, author, revision } = await world();
    const stored = await store.recordScore(author.id, revision.id, aRound());
    expect(stored.userId).toBe(author.id);
    expect(stored.revisionId).toBe(revision.id);
    expect(stored.result).toEqual(aRound());
    expect(await store.listScoresForUser(author.id)).toEqual([stored]);
  });
});

describe('the boundary still validates', () => {
  it('refuses an implausible score', async () => {
    const { store, author, revision } = await world();
    await expect(store.recordScore(author.id, revision.id, aRound({ score: 9_000_000 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('refuses a beatmap for a song that does not exist', async () => {
    const { store, author, song } = await world();
    await expect(
      store.createBeatmap({
        songId: author.id as unknown as typeof song.id,
        authorId: author.id,
        difficulty: 'easy',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('renames a user without changing their id', async () => {
    const { store } = await openTestStore();
    const user = await store.createUser({ displayName: 'Vero' });
    const renamed = await store.renameUser(user.id, 'Mochi');
    expect(renamed.id).toBe(user.id);
    expect(renamed.displayName).toBe('Mochi');
  });
});
