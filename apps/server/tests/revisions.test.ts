/**
 * Phase 3 gate: a published revision is provably immutable.
 *
 * Writing again creates revision 2. Revision 1 is the same bytes it was
 * when it was published. There is no update path — if one appears, the
 * snapshot assertion fails.
 */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@neko/server';
import { openTestStore, tap, timing } from './helpers.ts';

async function drafted() {
  const opened = await openTestStore();
  const author = await opened.store.createUser({ displayName: 'Vero' });
  const song = await opened.store.createSong({
    provider: 'clickTrack',
    providerMediaId: 'click-rev',
    title: 'Click',
    artist: 'Metronome',
    durationMs: 15_000,
  });
  const beatmap = await opened.store.createBeatmap({
    songId: song.id,
    authorId: author.id,
    difficulty: 'normal',
  });
  return { ...opened, author, song, beatmap };
}

describe('revisions are insert-only', () => {
  it('publishing twice leaves revision 1 byte-identical', async () => {
    const { store, beatmap } = await drafted();
    const first = await store.writeRevision(beatmap.id, {
      timing: timing(),
      notes: [tap({ id: 'a', timeMs: 1000 })],
    });
    const published = await store.publish(beatmap.id);
    expect(published.status).toBe('published');
    expect(published.currentRevisionId).toBe(first.id);
    const snapshot = structuredClone(first);

    const second = await store.writeRevision(beatmap.id, {
      timing: timing(),
      notes: [tap({ id: 'b', timeMs: 2000, lane: 'down' })],
    });
    expect(second.revision).toBe(2);
    expect(second.id).not.toBe(first.id);

    expect(await store.getRevision(first.id)).toEqual(snapshot);
    expect(JSON.stringify(await store.getRevision(first.id))).toBe(JSON.stringify(snapshot));

    const again = await store.publish(beatmap.id);
    expect(again.publishedAtIso).toBe(published.publishedAtIso);
    expect(again.currentRevisionId).toBe(second.id);
    expect(await store.getRevision(first.id)).toEqual(snapshot);
  });

  it('refuses to publish a beatmap with no notes written', async () => {
    const { store, beatmap } = await drafted();
    await expect(store.publish(beatmap.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it('joins a playable chart from the three tables', async () => {
    const { store, beatmap, song } = await drafted();
    const revision = await store.writeRevision(beatmap.id, { timing: timing(), notes: [tap()] });
    await store.publish(beatmap.id);
    const playable = await store.getPlayable(revision.id);
    expect(playable?.song.id).toBe(song.id);
    expect(playable?.beatmap.id).toBe(beatmap.id);
    expect(playable?.revision.id).toBe(revision.id);
  });
});
