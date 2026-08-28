/**
 * YouTube as the clock source. §11's `YouTubePlaybackAdapter`.
 *
 * Its clock is the coarsest we have: `getCurrentTime()` moves in steps of a few
 * hundred milliseconds, stalls while buffering, and jumps on a seek. That is
 * fine, and expected — `MediaClock` in `@neko/game-core` exists for exactly
 * this shape of source. It interpolates between samples, slews off persistent
 * bias, and hard-resyncs on a jump. Nothing here should try to smooth anything:
 * this reports what the player says, honestly, including when the player has
 * stopped saying anything new.
 */
import type { MediaSource } from '@neko/protocol';
import type { PlaybackAdapter, PlaybackState } from './PlaybackAdapter.ts';
import { YT_STATE, loadYouTubeApi, type YouTubeApi, type YouTubePlayer } from './YouTubeApi.ts';
import { YouTubePlaybackError, youTubeError } from './YouTubeErrors.ts';

/**
 * A load that was replaced before it finished.
 *
 * Thrown rather than quietly resolved. A promise that resolves when the thing
 * did not happen is the exact shape of bug this repository keeps paying for —
 * each part correct alone, wrong in company — and here it would mean a caller
 * calling `play()` believing its song is up when a different one is.
 *
 * The caller that caused the replacement has normally stopped awaiting the
 * first load, so this is usually thrown into a promise nobody is holding. That
 * is the point: the one caller who *is* still waiting is the one who needs it.
 */
export class LoadReplacedError extends Error {
  constructor() {
    super('That load was replaced by a newer one.');
    this.name = 'LoadReplacedError';
  }
}

export interface YouTubeAdapterOptions {
  /** The element the player is mounted into. It must stay visible. */
  container: HTMLElement;
  /**
   * Called if the video fails AFTER it has loaded.
   *
   * A video can die mid-song — the network drops, or a restriction applies to a
   * later segment. Without this the clock simply stops and the player is left
   * staring at a chart that has stopped moving, with no explanation.
   */
  onLateError?: (error: YouTubePlaybackError) => void;
  /** Injected in tests. Nothing automated loads the real API. */
  api?: YouTubeApi | (() => Promise<YouTubeApi>);
  /**
   * How long a load may take before it is called a failure.
   *
   * A load that never answers is worse than one that fails: the lobby waits on
   * it and there is no state anyone can act on. Ten seconds is long enough for
   * a slow connection to produce a player, and short enough that a dead one is
   * reported inside the ~15 second setup window rather than after it.
   */
  loadTimeoutMs?: number;
}

export const DEFAULT_LOAD_TIMEOUT_MS = 10_000;

/** What the adapter is waiting for, and how to end the wait. */
interface Pending {
  token: number;
  /** A first load completes on `onReady`; a re-load completes on `CUED`. */
  mode: 'ready' | 'cued';
  settle: (error?: Error) => void;
}

export class YouTubeAdapter implements PlaybackAdapter {
  private readonly container: HTMLElement;
  private readonly onLateError: ((error: YouTubePlaybackError) => void) | undefined;
  private readonly getApi: () => Promise<YouTubeApi>;
  private readonly loadTimeoutMs: number;

  private player: YouTubePlayer | null = null;
  private loaded: MediaSource | null = null;
  private loading = false;
  private disposed = false;
  private pending: Pending | null = null;

  /**
   * Which load the events arriving now belong to.
   *
   * Two songs in quick succession — someone changes their pick during setup —
   * and the first load's `onReady` can arrive after the second has started.
   * Without a token it resolves the second load with the first video's player
   * and the room plays the wrong song. The same class of bug already cost a
   * round in multiplayer, where a `CAN_PLAY` answer about an abandoned song was
   * applied to its replacement.
   */
  private loadToken = 0;

  constructor(options: YouTubeAdapterOptions) {
    this.container = options.container;
    this.onLateError = options.onLateError;
    this.loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;

    const api = options.api;
    this.getApi =
      typeof api === 'function' ? api : api ? () => Promise.resolve(api) : loadYouTubeApi;
  }

  async load(source: MediaSource): Promise<void> {
    if (this.disposed) throw new Error('This adapter has been disposed.');

    // §11 lets any provider be handed to any adapter, so the type system is not
    // the check here — rule 0: everything from outside is data. A click-track
    // source reaching a YouTube player would otherwise become a mystery failure
    // on a video id that never existed.
    if (source.provider !== 'youtube') {
      throw new Error(`YouTubeAdapter was given a '${source.provider}' source.`);
    }

    // Whatever was in flight is over; its caller is told rather than left.
    this.pending?.settle(new LoadReplacedError());

    const token = ++this.loadToken;
    this.loading = true;
    this.loaded = null;

    try {
      if (this.player) await this.cue(this.player, source.providerMediaId, token);
      else await this.create(source.providerMediaId, token);
    } finally {
      if (token === this.loadToken) this.loading = false;
    }

    if (token !== this.loadToken || this.disposed) throw new LoadReplacedError();
    this.loaded = source;
  }

  /** First load: the player is built around the video. */
  private async create(videoId: string, token: number): Promise<void> {
    const api = await this.getApi();
    if (token !== this.loadToken || this.disposed) throw new LoadReplacedError();

    // `ownerDocument` rather than the global `document`: this file is unit
    // tested without a DOM, and a container that brings its own document is the
    // difference between a fake element and a browser dependency.
    const mount = this.container.ownerDocument.createElement('div');
    this.container.appendChild(mount);

    const ready = this.wait(token, 'ready');

    try {
      this.player = new api.Player(mount, {
        videoId,
        playerVars: {
          // Controls stay on and branding stays put. Hiding the player or
          // stripping its controls is what the developer policies forbid, and
          // it is also just rude to the people whose work this is.
          controls: 1,
          rel: 0,
          playsinline: 1,
          // Named explicitly, as YouTube's documentation asks. The page is
          // served from a `.local` hostname as often as from localhost, and
          // both are legitimate origins here.
          origin: window.location.origin,
        },
        events: {
          onReady: () => this.handleReady(),
          onStateChange: (event) => this.handleState(event.data),
          onError: (event) => this.handleError(event.data),
        },
      });
    } catch (err) {
      // The constructor THROWS for a malformed id — synchronously, before there
      // is any error event to listen for. Left unwrapped it escapes as a plain
      // Error carrying YouTube's own "Invalid video id", which loses the code
      // that everything downstream keys off.
      this.pending?.settle(
        new YouTubePlaybackError(
          2,
          err instanceof Error ? err.message : 'YouTube rejected that video id.',
          youTubeError(2).hint,
        ),
      );
    }

    await ready;
  }

  /** Every load after the first: the player stays, the video changes. */
  private async cue(player: YouTubePlayer, videoId: string, token: number): Promise<void> {
    const cued = this.wait(token, 'cued');
    try {
      player.cueVideoById(videoId);
    } catch (err) {
      this.pending?.settle(
        new YouTubePlaybackError(
          2,
          err instanceof Error ? err.message : 'YouTube rejected that video id.',
          youTubeError(2).hint,
        ),
      );
    }
    await cued;
  }

  /**
   * One resolution per load, and a timeout on every one of them.
   *
   * Every path out of a load goes through the returned `settle`, so "resolved
   * twice", "rejected after resolving" and "answered for a load nobody is
   * waiting on" are impossible by construction rather than by care.
   */
  private wait(token: number, mode: Pending['mode']): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        settle(
          new YouTubePlaybackError(
            0,
            'YouTube did not load that video in time.',
            'Check the connection, then try the song again.',
          ),
        );
      }, this.loadTimeoutMs);

      const settle = (error?: Error) => {
        if (this.pending?.token !== token) return;
        this.pending = null;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      this.pending = { token, mode, settle };
    });
  }

  private handleReady(): void {
    if (this.pending?.mode === 'ready') this.pending.settle();
  }

  private handleState(state: number): void {
    // `CUED` is where a cued video lands once it is ready and has not been
    // asked to play. Resolving on anything earlier reports a video as loaded
    // while it is still fetching, which is the exact thing
    // prepare-before-countdown exists to prevent. `PAUSED` is accepted too:
    // a player that had been playing lands there instead.
    if (this.pending?.mode !== 'cued') return;
    if (state === YT_STATE.CUED || state === YT_STATE.PAUSED) this.pending.settle();
  }

  private handleError(code: number): void {
    const error = youTubeError(code);
    // Before a load finishes, this is why the song never started. After it, the
    // song has already begun and the caller has to be told separately.
    if (this.pending) this.pending.settle(error);
    else if (this.loaded) this.onLateError?.(error);
  }

  play(): void {
    this.player?.playVideo();
  }

  pause(): void {
    this.player?.pauseVideo();
  }

  seek(timeMs: number): void {
    this.player?.seekTo(timeMs / 1000, true);
  }

  currentTimeMs(): number {
    if (!this.isReady() || !this.player) return 0;
    return this.player.getCurrentTime() * 1000;
  }

  durationMs(): number | null {
    if (!this.isReady() || !this.player) return null;
    const seconds = this.player.getDuration();
    // Zero means "not known yet", not "a zero-length video". Reporting it as a
    // real duration is one of the three ways a chart comes to outlive its song.
    return seconds > 0 ? seconds * 1000 : null;
  }

  state(): PlaybackState {
    if (this.loading) return 'loading';
    if (!this.player || !this.loaded) return 'idle';
    switch (this.player.getPlayerState()) {
      case YT_STATE.PLAYING:
        return 'playing';
      case YT_STATE.PAUSED:
        return 'paused';
      // Buffering is reported honestly rather than as 'playing'. The clock
      // stops advancing, judgment stops with it, and notes cannot silently
      // expire against a video that has stalled.
      case YT_STATE.BUFFERING:
        return 'buffering';
      case YT_STATE.ENDED:
        return 'ended';
      default:
        return 'idle';
    }
  }

  isReady(): boolean {
    return !this.loading && this.loaded !== null && this.player !== null;
  }

  isPlaying(): boolean {
    return this.state() === 'playing';
  }

  /** Which source is loaded right now, or `null`. */
  source(): MediaSource | null {
    return this.loaded;
  }

  dispose(): void {
    this.disposed = true;
    // Bump the token so anything still in flight resolves against a player that
    // no longer exists rather than touching a destroyed one.
    this.loadToken += 1;
    this.pending?.settle(new LoadReplacedError());
    try {
      this.player?.destroy();
    } catch {
      // A player that will not tear down must not break the teardown that used
      // it. There is nothing to do about it and nothing that depends on it.
    }
    this.player = null;
    this.loaded = null;
    this.loading = false;
  }
}
