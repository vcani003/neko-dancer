/**
 * YouTube as the clock source.
 *
 * The official IFrame Player API, with the player visible and functional —
 * which is both YouTube's requirement and the only route that does not involve
 * touching the audio. Nothing is downloaded, extracted, isolated or modified;
 * we ask a player we do not control what time it is, and schedule against that.
 *
 * The consequence worth stating up front: **the audio is unreachable.** There
 * are no samples to analyse, so a chart for a YouTube song cannot be generated
 * from its sound. It has to be authored against the clock instead — tapped in
 * while it plays. That is a real constraint, not a temporary one.
 *
 * Its clock is the coarsest we have. `getCurrentTime()` updates in steps of a
 * few hundred milliseconds, it stalls while buffering, and it jumps on a seek.
 * GameClock was built for exactly this: it interpolates between samples, slews
 * off persistent bias, and hard-resyncs on a jump.
 */
import type { PlaybackAdapter, PlaybackState } from './PlaybackAdapter.ts';

/**
 * A video that will not play, and why.
 *
 * YouTube says exactly what went wrong — a number on the error event — and the
 * first version of this threw all of it away in favour of "that video cannot
 * be played here". Two people then spent a round unable to tell whether the
 * problem was the link, the network, the room or the game.
 *
 * The distinction that matters most: a video can be perfectly playable on
 * youtube.com and still refuse to play inside another site. That is the
 * uploader's setting, it is not something this game can work around, and the
 * only fix is a different upload — which is worth saying out loud rather than
 * leaving someone to reload hopefully.
 */
export class YouTubePlaybackError extends Error {
  readonly code: number;
  readonly hint: string;

  constructor(code: number, message: string, hint: string) {
    super(message);
    this.name = 'YouTubePlaybackError';
    this.code = code;
    this.hint = hint;
  }
}

/** https://developers.google.com/youtube/iframe_api_reference#onError */
export function describeYouTubeError(code: number): { message: string; hint: string } {
  switch (code) {
    case 2:
      return {
        message: 'YouTube did not recognise that video id.',
        hint: 'Add the song again from its YouTube link.',
      };
    case 5:
      return {
        message: "YouTube's player could not start in this browser.",
        hint: 'Reload the page, and try a different browser if it keeps happening.',
      };
    case 100:
      return {
        message: 'That video is private, deleted, or not available in your country.',
        hint: 'Someone else may still be able to see it — try another upload of the song.',
      };
    case 101:
    case 150:
      return {
        // The one people misread as a bug in the game. It is not: the video
        // plays on youtube.com and is blocked everywhere else, on purpose.
        message: 'The uploader does not allow this video to play outside YouTube.',
        hint: 'Nothing here can change that — pick a different upload of the same song.',
      };
    default:
      return {
        message: `YouTube refused to play that video (error ${code}).`,
        hint: 'Try another upload of the song.',
      };
  }
}

/** YouTube's player states, which arrive as bare numbers. */
const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement | string,
    options: Record<string, unknown>,
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api';
let apiPromise: Promise<YouTubeApi> | null = null;

/**
 * Load the IFrame API once, however many players ask for it.
 *
 * It signals readiness through a single global callback, so a second script
 * tag would either be ignored or clobber the first one's handler.
 */
function loadApi(): Promise<YouTubeApi> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('The YouTube API loaded without a Player.'));
    };

    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('Could not reach the YouTube player API.'));
    document.head.appendChild(script);
  });

  return apiPromise;
}

export interface YouTubeAdapterOptions {
  videoId: string;
  /** The element the player is mounted into. It must stay visible. */
  container: HTMLElement;
  /**
   * Called if the video fails AFTER it has started.
   *
   * A video can die mid-song — the network drops, or a restriction is applied
   * on a later segment. Without this the clock simply stops and the player is
   * left staring at a chart that has stopped moving with no explanation.
   */
  onLateError?: (error: YouTubePlaybackError) => void;
}

export class YouTubeAdapter implements PlaybackAdapter {
  private player: YouTubePlayer | null = null;
  private ready = false;

  private constructor() {}

  static async create(options: YouTubeAdapterOptions): Promise<YouTubeAdapter> {
    const api = await loadApi();
    const adapter = new YouTubeAdapter();

    const mount = document.createElement('div');
    options.container.appendChild(mount);

    await new Promise<void>((resolve, reject) => {
      const config = {
        videoId: options.videoId,
        playerVars: {
          // Controls stay on and branding stays put. Hiding the player or
          // stripping its controls is what the developer policies forbid, and
          // it is also just rude to the people whose work this is.
          controls: 1,
          rel: 0,
          playsinline: 1,
          // Named explicitly, as YouTube's documentation asks. The page is
          // served from a LAN address as often as from localhost, and both are
          // legitimate origins here.
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            adapter.ready = true;
            resolve();
          },
          onError: (event: { data: number }) => {
            const { message, hint } = describeYouTubeError(event.data);
            const error = new YouTubePlaybackError(event.data, message, hint);
            // Before onReady this is why the song never started. After it, the
            // song has already begun and the caller has to be told separately.
            if (adapter.ready) options.onLateError?.(error);
            else reject(error);
          },
        },
      };

      try {
        adapter.player = new api.Player(mount, config);
      } catch (err) {
        // The constructor THROWS for a malformed id — synchronously, before
        // there is any error event to listen for. Left unwrapped it escapes as
        // a plain Error carrying YouTube's own "Invalid video id", which loses
        // the code that everything downstream keys off.
        const { hint } = describeYouTubeError(2);
        reject(
          new YouTubePlaybackError(
            2,
            err instanceof Error ? err.message : 'YouTube rejected that video id.',
            hint,
          ),
        );
      }
    });

    return adapter;
  }

  play(): void {
    this.player?.playVideo();
  }

  pause(): void {
    this.player?.pauseVideo();
  }

  getCurrentTimeMs(): number {
    if (!this.ready || !this.player) return 0;
    return this.player.getCurrentTime() * 1000;
  }

  getState(): PlaybackState {
    if (!this.ready || !this.player) return 'idle';
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

  getDurationMs(): number | null {
    if (!this.ready || !this.player) return null;
    const duration = this.player.getDuration();
    return duration > 0 ? duration * 1000 : null;
  }

  seekMs(timeMs: number): void {
    this.player?.seekTo(timeMs / 1000, true);
  }

  dispose(): void {
    this.player?.destroy();
    this.player = null;
    this.ready = false;
  }
}
