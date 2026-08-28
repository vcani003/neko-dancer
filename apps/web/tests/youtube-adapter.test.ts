/**
 * The adapter, against a player that does nothing until the test says so.
 *
 * Everything here is a sequence of events the real player produces in some
 * order the code cannot control — ready then error, error then ready, a second
 * load arriving before the first answers. Those orderings are where every
 * playback bug so far has lived, and they are the whole reason the fake fires
 * events by hand instead of simulating a video.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMediaSource } from '../src/playback/FakePlaybackAdapter.ts';
import { YT_STATE } from '../src/playback/YouTubeApi.ts';
import { LoadReplacedError, YouTubeAdapter } from '../src/playback/YouTubeAdapter.ts';
import { YouTubePlaybackError } from '../src/playback/YouTubeErrors.ts';
import { fakeContainer, fakeYouTubeApi, flush, withFakeWindow } from './fakes.ts';

const song = (id = 'dQw4w9WgXcQ') =>
  fakeMediaSource({ provider: 'youtube', providerMediaId: id, title: 'Song' });

beforeEach(() => {
  withFakeWindow();
});

/** Build an adapter and drive its first load to ready. */
async function loaded(overrides: { onLateError?: (e: YouTubePlaybackError) => void } = {}) {
  const api = fakeYouTubeApi();
  const adapter = new YouTubeAdapter({ container: fakeContainer(), api, ...overrides });
  const load = adapter.load(song());
  await flush();
  api.last().emitReady();
  await load;
  return { adapter, api, player: api.last() };
}

describe('loading', () => {
  it('resolves once the player says it is ready', async () => {
    const { adapter, player } = await loaded();
    expect(adapter.isReady()).toBe(true);
    expect(player.videoId).toBe('dQw4w9WgXcQ');
  });

  it('is not ready while it is still loading', async () => {
    const api = fakeYouTubeApi();
    const adapter = new YouTubeAdapter({ container: fakeContainer(), api });
    const load = adapter.load(song());
    await flush();

    expect(adapter.state()).toBe('loading');
    expect(adapter.isReady()).toBe(false);
    // A loading adapter reports no time. Reporting zero as a real position
    // would let a countdown start against a video that has not arrived.
    expect(adapter.currentTimeMs()).toBe(0);

    api.last().emitReady();
    await load;
  });

  it('rejects with YouTube’s own reason when the video will not play', async () => {
    const api = fakeYouTubeApi();
    const adapter = new YouTubeAdapter({ container: fakeContainer(), api });
    const load = adapter.load(song());
    await flush();
    api.last().emitError(150);

    const error = (await load.catch((e) => e)) as YouTubePlaybackError;
    expect(error).toBeInstanceOf(YouTubePlaybackError);
    expect(error.code).toBe(150);
    // The one people misread as a bug in the game.
    expect(error.message).toMatch(/outside YouTube/i);
    expect(adapter.isReady()).toBe(false);
  });

  it('turns the constructor’s synchronous throw into code 2', async () => {
    // A malformed id makes the real constructor throw before any error event
    // exists to listen for. Unwrapped it escapes as a plain Error and loses the
    // code everything downstream keys off.
    const api = fakeYouTubeApi({ throwOnConstruct: new Error('Invalid video id') });
    const adapter = new YouTubeAdapter({ container: fakeContainer(), api });

    const error = (await adapter.load(song()).catch((e) => e)) as YouTubePlaybackError;
    expect(error).toBeInstanceOf(YouTubePlaybackError);
    expect(error.code).toBe(2);
  });

  it('refuses a source belonging to another provider', async () => {
    const api = fakeYouTubeApi();
    const adapter = new YouTubeAdapter({ container: fakeContainer(), api });
    await expect(adapter.load(fakeMediaSource())).rejects.toThrow(/clickTrack/);
  });

  it('gives up rather than waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const api = fakeYouTubeApi();
      const adapter = new YouTubeAdapter({ container: fakeContainer(), api, loadTimeoutMs: 50 });
      const load = adapter.load(song());
      const settled = load.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(60);

      const error = (await settled) as YouTubePlaybackError;
      expect(error).toBeInstanceOf(YouTubePlaybackError);
      expect(error.message).toMatch(/in time/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a second load', () => {
  it('cues into the player that already exists rather than building another', async () => {
    const { adapter, api } = await loaded();
    const second = adapter.load(song('kJQP7kiw5Fk'));
    await flush();
    api.last().emitState(YT_STATE.CUED);
    await second;

    expect(api.players).toHaveLength(1);
    expect(api.last().calls).toContain('cueVideoById:kJQP7kiw5Fk');
    expect(adapter.source()?.providerMediaId).toBe('kJQP7kiw5Fk');
  });

  it('waits for CUED, not for the request', async () => {
    // Resolving on the call would report a video as loaded while it is still
    // fetching — the exact thing prepare-before-countdown exists to prevent.
    const { adapter, api } = await loaded();
    let done = false;
    const second = adapter.load(song('kJQP7kiw5Fk')).then(() => (done = true));
    await flush();
    expect(done).toBe(false);

    api.last().emitState(YT_STATE.CUED);
    await second;
    expect(done).toBe(true);
  });

  it('does not let an overtaken load answer for the one that replaced it', async () => {
    // Two picks in quick succession during setup. The first load’s answer
    // arriving late must not resolve the second, or the room plays the wrong
    // song — the same shape as the CAN_PLAY answer that cost a round.
    const { adapter, api } = await loaded();

    const first = adapter.load(song('aaaaaaaaaaa'));
    const firstSettled = first.catch((e) => e);
    const second = adapter.load(song('bbbbbbbbbbb'));
    await flush();

    expect(await firstSettled).toBeInstanceOf(LoadReplacedError);

    api.last().emitState(YT_STATE.CUED);
    await second;
    expect(adapter.source()?.providerMediaId).toBe('bbbbbbbbbbb');
  });
});

describe('reporting what the player is doing', () => {
  it.each([
    [YT_STATE.PLAYING, 'playing'],
    [YT_STATE.PAUSED, 'paused'],
    [YT_STATE.BUFFERING, 'buffering'],
    [YT_STATE.ENDED, 'ended'],
    [YT_STATE.UNSTARTED, 'idle'],
  ] as const)('maps %i to %s', async (ytState, expected) => {
    const { adapter, player } = await loaded();
    player.playerState = ytState;
    expect(adapter.state()).toBe(expected);
  });

  it('calls buffering buffering, not playing', async () => {
    // Reported as playing, the clock keeps advancing and notes expire against a
    // frozen picture.
    const { adapter, player } = await loaded();
    player.playerState = YT_STATE.BUFFERING;
    expect(adapter.isPlaying()).toBe(false);
  });

  it('reports the position in milliseconds', async () => {
    const { adapter, player } = await loaded();
    player.currentTime = 12.5;
    expect(adapter.currentTimeMs()).toBe(12_500);
  });

  it('says nothing about duration until the player knows one', async () => {
    // Zero means "not known yet", not "a zero-length video".
    const { adapter, player } = await loaded();
    expect(adapter.durationMs()).toBeNull();
    player.duration = 213;
    expect(adapter.durationMs()).toBe(213_000);
  });

  it('seeks in seconds, because that is what the player speaks', async () => {
    const { adapter, player } = await loaded();
    adapter.seek(90_000);
    expect(player.calls).toContain('seekTo:90:true');
  });
});

describe('failing after it started', () => {
  it('tells the caller instead of just stopping', async () => {
    // Without this the clock stops and the player stares at a chart that has
    // stopped moving, with no explanation.
    const errors: YouTubePlaybackError[] = [];
    const { player } = await loaded({ onLateError: (e) => errors.push(e) });

    player.emitError(100);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(100);
  });

  it('does not route a load failure to the late handler', async () => {
    const errors: YouTubePlaybackError[] = [];
    const api = fakeYouTubeApi();
    const adapter = new YouTubeAdapter({
      container: fakeContainer(),
      api,
      onLateError: (e) => errors.push(e),
    });
    const load = adapter.load(song());
    await flush();
    api.last().emitError(101);

    await expect(load).rejects.toBeInstanceOf(YouTubePlaybackError);
    expect(errors).toHaveLength(0);
  });
});

describe('disposal', () => {
  it('destroys the player and stops being ready', async () => {
    const { adapter, player } = await loaded();
    adapter.dispose();

    expect(player.destroyed).toBe(true);
    expect(adapter.isReady()).toBe(false);
    expect(adapter.state()).toBe('idle');
  });

  it('survives a player that will not tear down', async () => {
    const { adapter, player } = await loaded();
    player.destroy = () => {
      throw new Error('gone');
    };
    expect(() => adapter.dispose()).not.toThrow();
  });

  it('ends a load in flight rather than leaving it hanging', async () => {
    const api = fakeYouTubeApi();
    const adapter = new YouTubeAdapter({ container: fakeContainer(), api });
    const load = adapter.load(song());
    const settled = load.catch((e) => e);
    await flush();

    adapter.dispose();
    expect(await settled).toBeInstanceOf(LoadReplacedError);
  });

  it('refuses to load again', async () => {
    const { adapter } = await loaded();
    adapter.dispose();
    await expect(adapter.load(song())).rejects.toThrow(/disposed/);
  });
});
