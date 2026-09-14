/**
 * Phase 4 gate: a full run against the fake adapter, from a scripted
 * sequence, asserting the final score. No network, no wall clock.
 *
 * Four PERFECT taps on the seeded tutorial, plus the completion bonus:
 * 4 × (7 × 2) + 5 = 61. That number is the gate. If scoring or the
 * session order changes, this fails on purpose.
 */
import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS } from '@neko/protocol';
import { openMemoryDb, seedLibrary, Store, SEED_REVISION_ID } from '@neko/server';
import { FakePlaybackAdapter } from '../src/playback/FakePlaybackAdapter.ts';
import { PlaySession } from '../src/play/PlaySession.ts';

async function readySession(): Promise<{ session: PlaySession; fake: FakePlaybackAdapter; store: Store }> {
  const { db } = await openMemoryDb();
  const store = new Store(db);
  await seedLibrary(store);
  const fake = new FakePlaybackAdapter();
  const session = new PlaySession({ catalog: store, adapter: fake });
  return { session, fake, store };
}

describe('the Phase 4 run', () => {
  it('lists the seeded chart, then plays a perfect scripted sequence for 61', async () => {
    const { session, fake } = await readySession();

    const listed = await session.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.revisionId).toBe(SEED_REVISION_ID);

    const chart = await session.choose(SEED_REVISION_ID);
    expect(session.currentPhase()).toBe('ready');
    expect(fake.calls[0]).toBe('load:clickTrack:metronome-30');
    expect(fake.isPlaying()).toBe(false);
    expect(chart.revision.notes).toHaveLength(4);

    session.beginCountdown(0);
    expect(session.currentPhase()).toBe('countdown');
    session.tick(COUNTDOWN_MS - 1);
    expect(session.currentPhase()).toBe('countdown');
    expect(fake.isPlaying()).toBe(false);

    session.tick(COUNTDOWN_MS);
    expect(session.currentPhase()).toBe('playing');
    expect(fake.calls).toContain('play');

    const script = [
      { timeMs: 1000, lane: 'left' },
      { timeMs: 2000, lane: 'down' },
      { timeMs: 3000, lane: 'up' },
      { timeMs: 4000, lane: 'right' },
    ] as const;

    for (const step of script) {
      fake.setTime(step.timeMs);
      const hit = session.press(step.lane);
      expect(hit?.judgment).toBe('PERFECT');
    }

    expect(session.currentPhase()).toBe('finished');
    expect(fake.calls).toContain('pause');
    expect(session.result()).toEqual({
      score: 61,
      combo: 4,
      accuracy: 1,
      health: 100,
      maxCombo: 4,
      counts: { PERFECT: 4, GREAT: 0, GOOD: 0, OKAY: 0, MISS: 0 },
      completed: true,
    });
  });

  it('misses every note when the clock runs past them with no presses', async () => {
    const { session, fake } = await readySession();
    await session.choose(SEED_REVISION_ID);
    session.beginCountdown(10_000);
    session.tick(10_000 + COUNTDOWN_MS);
    fake.setTime(5000);
    session.tick(10_000 + COUNTDOWN_MS + 1);

    expect(session.currentPhase()).toBe('finished');
    expect(session.result()).toEqual({
      score: 5,
      combo: 0,
      accuracy: 0,
      health: 76,
      maxCombo: 0,
      counts: { PERFECT: 0, GREAT: 0, GOOD: 0, OKAY: 0, MISS: 4 },
      completed: true,
    });
  });

  it('stores the self-reported result when asked', async () => {
    const { session, fake, store } = await readySession();
    await session.choose(SEED_REVISION_ID);
    session.beginCountdown(0);
    session.tick(COUNTDOWN_MS);
    for (const [timeMs, lane] of [
      [1000, 'left'],
      [2000, 'down'],
      [3000, 'up'],
      [4000, 'right'],
    ] as const) {
      fake.setTime(timeMs);
      session.press(lane);
    }
    const user = await store.createUser({ displayName: 'Vero' });
    await session.saveResult(user.id);
    const scores = await store.listScoresForUser(user.id);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.result.score).toBe(61);
    expect(scores[0]?.revisionId).toBe(SEED_REVISION_ID);
  });

  it('will play a draft — Staging is how a chart gets heard before it is public', async () => {
    const { session, store } = await readySession();
    const author = await store.createUser({ displayName: 'Author' });
    const song = await store.createSong({
      provider: 'clickTrack',
      providerMediaId: 'draft-click',
      durationMs: 4000,
      title: 'Draft click',
    });
    const beatmap = await store.createBeatmap({
      songId: song.id,
      authorId: author.id,
      difficulty: 'normal',
      title: 'Draft click',
    });
    const revision = await store.writeRevision(beatmap.id, {
      timing: [{ timeMs: 0, bpm: 120, beat: 0 }],
      notes: [{ id: 'd1', timeMs: 1000, lane: 'left', type: 'tap' }],
    });
    expect(beatmap.status).toBe('draft');
    await session.choose(revision.id);
    expect(session.currentPhase()).toBe('ready');
    expect(session.playable()?.beatmap.status).toBe('draft');
  });

  it('lets a late joiner watch without scoring presses', async () => {
    const { session, fake } = await readySession();
    await session.choose(SEED_REVISION_ID);
    session.beginSpectate(2_000);
    expect(session.currentPhase()).toBe('playing');
    expect(session.isSpectating()).toBe(true);
    expect(fake.calls).toContain('seek:2000');
    expect(fake.calls).toContain('play');
    fake.setTime(2_000);
    expect(session.press('left')).toBeNull();
    fake.setTime(30_000);
    session.tick(0);
    expect(session.currentPhase()).toBe('finished');
    expect(session.result()?.score).toBe(0);
  });

  it('exposes countdown remaining, progress, and notes worth drawing', async () => {
    const { session } = await readySession();
    expect(session.progress()).toBeNull();
    expect(session.visible(1600)).toEqual([]);

    await session.choose(SEED_REVISION_ID);
    expect(session.progress()?.score).toBe(0);
    session.beginCountdown(0);
    expect(session.countdownRemainingMs(0)).toBe(COUNTDOWN_MS);
    expect(session.countdownRemainingMs(1_000)).toBe(COUNTDOWN_MS - 1_000);
    session.tick(COUNTDOWN_MS);
    expect(session.countdownRemainingMs(COUNTDOWN_MS)).toBe(0);
    expect(session.visible(1600).map((n) => n.note.id)).toEqual(['n1']);
  });
});
