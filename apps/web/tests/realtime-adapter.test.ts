/**
 * The wall-clock adapter. `now` is injected; the clock moves only when
 * that function's answer does. Same contract as the fake, different source
 * of time — this is what the browser uses for a click-track.
 */
import { describe, expect, it } from 'vitest';
import { fakeMediaSource } from '../src/playback/FakePlaybackAdapter.ts';
import { RealtimeAdapter } from '../src/playback/RealtimeAdapter.ts';
import type { PlaybackAdapter } from '../src/playback/PlaybackAdapter.ts';

describe('the clock follows the injected now', () => {
  it('is a PlaybackAdapter', () => {
    const adapter: PlaybackAdapter = new RealtimeAdapter({ now: () => 0 });
    expect(adapter.state()).toBe('idle');
  });

  it('starts at zero and only advances while playing', async () => {
    let t = 1_000;
    const adapter = new RealtimeAdapter({ now: () => t, durationMs: 30_000 });
    await adapter.load(fakeMediaSource({ durationMs: 30_000 }));
    expect(adapter.isReady()).toBe(true);
    expect(adapter.isPlaying()).toBe(false);
    expect(adapter.currentTimeMs()).toBe(0);

    adapter.play();
    expect(adapter.isPlaying()).toBe(true);
    expect(adapter.currentTimeMs()).toBe(0);
    t = 1_400;
    expect(adapter.currentTimeMs()).toBe(400);

    adapter.pause();
    t = 5_000;
    expect(adapter.currentTimeMs()).toBe(400);
    expect(adapter.isPlaying()).toBe(false);

    adapter.play();
    t = 5_250;
    expect(adapter.currentTimeMs()).toBe(650);
  });

  it('seeks, and cannot hold a negative position', async () => {
    let t = 0;
    const adapter = new RealtimeAdapter({ now: () => t });
    await adapter.load(fakeMediaSource());
    adapter.play();
    adapter.seek(2_000);
    expect(adapter.currentTimeMs()).toBe(2_000);
    t = 500;
    expect(adapter.currentTimeMs()).toBe(2_500);
    adapter.seek(-50);
    expect(adapter.currentTimeMs()).toBe(0);
  });

  it('takes duration from the source when the source has one', async () => {
    const adapter = new RealtimeAdapter({ now: () => 0 });
    await adapter.load(fakeMediaSource({ durationMs: 12_000 }));
    expect(adapter.durationMs()).toBe(12_000);
  });
});
