/**
 * The fake is a test subject too.
 *
 * Everything the engine will be proven against runs through this, so a fake
 * that quietly disagrees with a real adapter would make a whole suite of green
 * tests meaningless. These assert the two properties that matter: it satisfies
 * the same contract, and its clock moves only when a test moves it.
 */
import { describe, expect, it } from 'vitest';
import { FakePlaybackAdapter, fakeMediaSource } from '../src/playback/FakePlaybackAdapter.ts';
import type { PlaybackAdapter } from '../src/playback/PlaybackAdapter.ts';

describe('the clock moves only when the test moves it', () => {
  it('starts at zero and stays there', async () => {
    const fake = new FakePlaybackAdapter();
    await fake.load(fakeMediaSource());
    fake.play();

    expect(fake.currentTimeMs()).toBe(0);
    // Real time passing changes nothing. A fake that advanced itself would make
    // every test depend on how long it took to run.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fake.currentTimeMs()).toBe(0);
  });

  it('is set and advanced explicitly', async () => {
    const fake = new FakePlaybackAdapter();
    await fake.load(fakeMediaSource());
    fake.setTime(10_000);
    expect(fake.currentTimeMs()).toBe(10_000);
    fake.advance(500);
    expect(fake.currentTimeMs()).toBe(10_500);
  });

  it('cannot be seeked before the start, because no source can be', async () => {
    const fake = new FakePlaybackAdapter();
    await fake.load(fakeMediaSource());
    fake.seek(-1000);
    expect(fake.currentTimeMs()).toBe(0);
  });
});

describe('states', () => {
  it('is idle until something is loaded', () => {
    const fake = new FakePlaybackAdapter();
    expect(fake.state()).toBe('idle');
    expect(fake.isReady()).toBe(false);
    // Play on nothing does nothing, rather than claiming to be playing.
    fake.play();
    expect(fake.isPlaying()).toBe(false);
  });

  it('models a stall as buffering, not as playing', async () => {
    const fake = new FakePlaybackAdapter();
    await fake.load(fakeMediaSource());
    fake.play();
    fake.setTime(4_000);
    fake.buffer();

    expect(fake.state()).toBe('buffering');
    expect(fake.isPlaying()).toBe(false);
    // The position is held, which is what a stalled source does.
    expect(fake.currentTimeMs()).toBe(4_000);
  });

  it('can end, so a run can end with it', async () => {
    const fake = new FakePlaybackAdapter();
    await fake.load(fakeMediaSource());
    fake.play();
    fake.end();
    expect(fake.state()).toBe('ended');
    expect(fake.isPlaying()).toBe(false);
  });

  it('rewinds to the start of whatever is loaded next', async () => {
    const fake = new FakePlaybackAdapter();
    await fake.load(fakeMediaSource());
    fake.setTime(30_000);
    await fake.load(fakeMediaSource({ providerMediaId: 'another' }));
    expect(fake.currentTimeMs()).toBe(0);
  });

  it('reports the failure it was built to fail with', async () => {
    const fake = new FakePlaybackAdapter({ failLoad: new Error('blocked here') });
    await expect(fake.load(fakeMediaSource())).rejects.toThrow('blocked here');
    expect(fake.isReady()).toBe(false);
  });
});

describe('duration', () => {
  it('says nothing by default', () => {
    expect(new FakePlaybackAdapter().durationMs()).toBeNull();
  });

  it('takes one from the source, so a fixture can carry its own length', async () => {
    const fake = new FakePlaybackAdapter();
    await fake.load(fakeMediaSource({ durationMs: 213_000 }));
    expect(fake.durationMs()).toBe(213_000);
  });
});

describe('it satisfies the contract', () => {
  it('has every member §11 and ADR-009 require', () => {
    // Assigning to the interface is the compile-time half; this is the half
    // that survives a member being deleted at runtime.
    const adapter: PlaybackAdapter = new FakePlaybackAdapter();
    for (const member of [
      'load',
      'play',
      'pause',
      'seek',
      'currentTimeMs',
      'durationMs',
      'state',
      'isReady',
      'isPlaying',
      'dispose',
    ]) {
      expect(typeof (adapter as unknown as Record<string, unknown>)[member]).toBe('function');
    }
  });

  it('records what was done to it, in order', async () => {
    const fake = new FakePlaybackAdapter();
    await fake.load(fakeMediaSource({ providerMediaId: 'x' }));
    fake.play();
    fake.seek(1_000);
    fake.pause();
    fake.dispose();
    expect(fake.calls).toEqual(['load:clickTrack:x', 'play', 'seek:1000', 'pause', 'dispose']);
  });
});
