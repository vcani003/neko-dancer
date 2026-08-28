/**
 * Stand-ins for the browser and for YouTube.
 *
 * These tests run in Node with no DOM and no network, because Part 4's rule is
 * absolute: **no automated test may require YouTube.** So the player is a fake
 * whose events the test fires by hand, and the DOM is the three methods the
 * playback layer actually touches.
 *
 * Building these rather than reaching for jsdom is deliberate. A fake with four
 * methods says exactly what the code under test depends on; a DOM library hides
 * that behind a working browser and lets the dependency grow unnoticed.
 */
import type {
  YouTubeApi,
  YouTubePlayer,
  YouTubePlayerOptions,
} from '../src/playback/YouTubeApi.ts';
import { YT_STATE } from '../src/playback/YouTubeApi.ts';

// ------------------------------------------------------------------ DOM ----

export interface FakeElement {
  tagName: string;
  children: FakeElement[];
  attributes: Record<string, string>;
  style: { cssText: string };
  ownerDocument: FakeDocument;
  appendChild(child: FakeElement): FakeElement;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

export interface FakeDocument {
  body: FakeElement;
  createElement(tagName: string): FakeElement;
}

export function fakeDocument(): FakeDocument {
  const doc: FakeDocument = {
    body: null as unknown as FakeElement,
    createElement(tagName: string): FakeElement {
      const element: FakeElement = {
        tagName,
        children: [],
        attributes: {},
        style: { cssText: '' },
        ownerDocument: doc,
        appendChild(child) {
          element.children.push(child);
          return child;
        },
        setAttribute(name, value) {
          element.attributes[name] = value;
        },
        remove() {
          element.children.length = 0;
        },
      };
      return element;
    },
  };
  doc.body = doc.createElement('body');
  return doc;
}

/** A container the adapter can mount into, carrying its own document. */
export function fakeContainer(): HTMLElement {
  return fakeDocument().createElement('div') as unknown as HTMLElement;
}

/**
 * `window.location.origin` is read when the player is configured — YouTube's
 * documentation asks for it explicitly. Node has no window, so one is supplied.
 */
export function withFakeWindow(origin = 'http://neko.local:5180'): void {
  (globalThis as { window?: unknown }).window = { location: { origin } };
}

// -------------------------------------------------------------- YouTube ----

/**
 * A player that does nothing until told to.
 *
 * Every real event — ready, a state change, an error — is a method here, so a
 * test states the sequence it is exercising instead of waiting for one.
 */
export class FakeYouTubePlayer implements YouTubePlayer {
  videoId: string;
  destroyed = false;
  currentTime = 0;
  duration = 0;
  playerState: number = YT_STATE.UNSTARTED;
  readonly calls: string[] = [];

  private readonly events: NonNullable<YouTubePlayerOptions['events']>;

  constructor(options: YouTubePlayerOptions) {
    this.videoId = options.videoId ?? '';
    this.events = options.events ?? {};
  }

  playVideo(): void {
    this.calls.push('playVideo');
    this.playerState = YT_STATE.PLAYING;
  }

  pauseVideo(): void {
    this.calls.push('pauseVideo');
    this.playerState = YT_STATE.PAUSED;
  }

  seekTo(seconds: number, allowSeekAhead: boolean): void {
    this.calls.push(`seekTo:${seconds}:${allowSeekAhead}`);
    this.currentTime = seconds;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getDuration(): number {
    return this.duration;
  }

  getPlayerState(): number {
    return this.playerState;
  }

  loadVideoById(videoId: string): void {
    this.calls.push(`loadVideoById:${videoId}`);
    this.videoId = videoId;
  }

  cueVideoById(videoId: string): void {
    this.calls.push(`cueVideoById:${videoId}`);
    this.videoId = videoId;
  }

  destroy(): void {
    this.calls.push('destroy');
    this.destroyed = true;
  }

  // ----------------------------------------------------------- the events --

  emitReady(): void {
    this.events.onReady?.();
  }

  emitState(state: number): void {
    this.playerState = state;
    this.events.onStateChange?.({ data: state });
  }

  emitError(code: number): void {
    this.events.onError?.({ data: code });
  }
}

export interface FakeApiOptions {
  /** Throw from the constructor, the way a malformed id makes it. */
  throwOnConstruct?: Error;
}

export interface FakeYouTubeApi extends YouTubeApi {
  players: FakeYouTubePlayer[];
  /** The most recently constructed player. */
  last(): FakeYouTubePlayer;
}

export function fakeYouTubeApi(options: FakeApiOptions = {}): FakeYouTubeApi {
  const players: FakeYouTubePlayer[] = [];
  const api = {
    Player: function (_element: HTMLElement | string, playerOptions: YouTubePlayerOptions) {
      if (options.throwOnConstruct) throw options.throwOnConstruct;
      const player = new FakeYouTubePlayer(playerOptions);
      players.push(player);
      return player;
    } as unknown as YouTubeApi['Player'],
    players,
    last(): FakeYouTubePlayer {
      const player = players[players.length - 1];
      if (!player) throw new Error('No player has been constructed.');
      return player;
    },
  };
  return api;
}

/** Let queued microtasks run, so an awaited promise can settle. */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
