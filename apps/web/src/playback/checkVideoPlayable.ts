/**
 * Can this browser play this video at all? (§26, the lobby preflight.)
 *
 * Loads the video into a hidden, muted player, waits for either `onReady` or an
 * error, and throws the player away. Nothing is shown and nothing is heard.
 *
 * The point is WHEN this runs. A restriction discovered during the countdown is
 * a surprise that has already wasted everyone's time; the same fact discovered
 * in the lobby is a row in the player list. Restrictions are per-viewer —
 * region, age, and the uploader's embedding setting — so this has to be
 * answered by each browser rather than looked up once and shared.
 *
 * `onReady` is not the end of it: a video can report ready and then fail, which
 * is exactly what an embedding-blocked video does. Hence the settle window.
 */
import { loadYouTubeApi, type YouTubeApi, type YouTubePlayer } from './YouTubeApi.ts';
import type { YouTubePlaybackError } from './YouTubeErrors.ts';
import { youTubeError } from './YouTubeErrors.ts';

/** What a preflight found out, without playing anything to anyone. */
export interface VideoCheck {
  ok: boolean;
  /** Absent when ok. */
  error?: YouTubePlaybackError;
}

export interface CheckOptions {
  /** How long after `onReady` to keep listening for a late refusal. */
  settleMs?: number;
  /** Injected in tests. Nothing automated loads the real API. */
  api?: YouTubeApi | (() => Promise<YouTubeApi>);
  /** Injected in tests, which run without a DOM. */
  doc?: Document;
}

export const DEFAULT_SETTLE_MS = 2500;
const GIVE_UP_MARGIN_MS = 8000;

export async function checkVideoPlayable(
  videoId: string,
  options: CheckOptions = {},
): Promise<VideoCheck> {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const doc = options.doc ?? document;
  const source = options.api;
  const getApi =
    typeof source === 'function' ? source : source ? () => Promise.resolve(source) : loadYouTubeApi;

  let api: YouTubeApi;
  try {
    api = await getApi();
  } catch {
    // An unreachable API is not the video's fault, and must not be reported as
    // "this song is blocked for you" — that would be a lie which outlives the
    // network blip that caused it. Optimism is the safe answer: the round then
    // fails loudly for the one person affected, instead of quietly excluding
    // everybody over a script that did not load.
    return { ok: true };
  }

  const mount = doc.createElement('div');
  mount.setAttribute('aria-hidden', 'true');
  mount.style.cssText =
    'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
  doc.body.appendChild(mount);

  // An array rather than a `let`, so the value assigned inside the promise is
  // still visible to `finally` without fighting the narrowing.
  const created: YouTubePlayer[] = [];
  try {
    return await new Promise<VideoCheck>((resolve) => {
      let settled = false;
      const finish = (result: VideoCheck) => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        if (readyTimer !== undefined) clearTimeout(readyTimer);
        resolve(result);
      };

      // A check that never answers would leave the lobby waiting forever.
      const giveUp = setTimeout(() => finish({ ok: true }), settleMs + GIVE_UP_MARGIN_MS);
      let readyTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        created.push(new api.Player(mount, {
          videoId,
          playerVars: { controls: 0, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              readyTimer = setTimeout(() => finish({ ok: true }), settleMs);
            },
            onError: (event) => finish({ ok: false, error: youTubeError(event.data) }),
          },
        }));
      } catch {
        // A malformed id makes the constructor throw synchronously, with no
        // error event ever arriving. Code 2 is what YouTube calls that.
        finish({ ok: false, error: youTubeError(2) });
      }
    });
  } finally {
    try {
      created[0]?.destroy();
    } catch {
      // A player that will not tear down must not break the check that used it.
    }
    mount.remove();
  }
}
