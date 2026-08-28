/**
 * The IFrame Player API, typed and loaded once.
 *
 * The official player, visible and with its controls intact — which is both
 * YouTube's requirement and the only route that does not involve touching the
 * audio. Nothing is downloaded, extracted or modified; we ask a player we do
 * not control what time it is and schedule against that.
 *
 * The consequence worth stating up front: **the audio is unreachable.** There
 * are no samples to analyse, so a chart for a YouTube song cannot be generated
 * from its sound. It is authored against the clock instead — tapped in while it
 * plays. That is a permanent constraint, not a gap.
 *
 * This module is separated from the adapter so the adapter can be handed a
 * fake. Nothing in the automated suite loads the real thing.
 */

/** https://developers.google.com/youtube/iframe_api_reference */
export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(videoId: string): void;
  cueVideoById(videoId: string): void;
  destroy(): void;
}

export interface YouTubePlayerOptions {
  videoId?: string;
  playerVars?: Record<string, unknown>;
  events?: {
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;
  };
}

export interface YouTubeApi {
  Player: new (element: HTMLElement | string, options: YouTubePlayerOptions) => YouTubePlayer;
}

/**
 * The two globals the IFrame API installs.
 *
 * Read through a local type rather than `declare global`. The prototype at the
 * repository root declares `Window.YT` too, and two `declare global` blocks for
 * the same property in one compilation are an error even when they agree — so
 * the ambient declaration is left to the code that is on its way out, and this
 * reads the window it actually has.
 */
interface YouTubeGlobals {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: () => void;
}

function globals(): YouTubeGlobals {
  return window as unknown as YouTubeGlobals;
}

/** Player states arrive as bare numbers. */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

const API_SRC = 'https://www.youtube.com/iframe_api';
let apiPromise: Promise<YouTubeApi> | null = null;

/**
 * Load the API once, however many players ask for it.
 *
 * It signals readiness through a single global callback, so a second script tag
 * would either be ignored or clobber the first one's handler. The existing
 * handler is chained rather than replaced for the same reason.
 */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const yt = globals();
    if (yt.YT?.Player) {
      resolve(yt.YT);
      return;
    }

    const previous = yt.onYouTubeIframeAPIReady;
    yt.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (yt.YT?.Player) resolve(yt.YT);
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
