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
      adapter.player = new api.Player(mount, {
        videoId: options.videoId,
        playerVars: {
          // Controls stay on and branding stays put. Hiding the player or
          // stripping its controls is what the developer policies forbid, and
          // it is also just rude to the people whose work this is.
          controls: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            adapter.ready = true;
            resolve();
          },
          onError: () => reject(new Error('That video cannot be played here.')),
        },
      });
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
