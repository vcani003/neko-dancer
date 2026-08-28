/**
 * YouTube, resolved. §11's `YouTubeProvider → MediaSource`.
 *
 * Two jobs, deliberately separate: read an id out of whatever was pasted, then
 * ask YouTube what that id is called. The first is pure string work and is
 * tested exhaustively; the second is a network call and is injected, because
 * Part 4's determinism rule is absolute — **no automated test may require
 * YouTube.**
 */
import type { MediaSource } from '@neko/protocol';
import { MediaResolveError, type MediaProvider } from './MediaProvider.ts';

/** YouTube ids are exactly eleven of these. */
const ID = /^[\w-]{11}$/;

/**
 * The id inside a pasted link, or `null` if there is not one.
 *
 * Ported from the prototype's `src/analysis/fromTempo.ts`, unchanged in
 * behaviour and moved because parsing a link is not tempo analysis.
 *
 * Every accepted shape is one a person has actually pasted: the desktop URL,
 * the mobile share link, `youtu.be`, an embed src copied out of a page, a
 * Shorts link, and a bare id — which is what you get when someone copies the
 * tail of a URL. Music YouTube is included because it is where people find
 * songs.
 */
export function youTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (ID.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // A pasted link often arrives without a scheme. Assuming https is safe
    // here: the alternative is rejecting `youtube.com/watch?v=...`, which is
    // what a browser's address bar shows and therefore what people copy.
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return ID.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v && ID.test(v)) return v;

    const match = url.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/);
    if (match) return match[2] ?? null;
  }

  return null;
}

/** The subset of oEmbed's response this uses. Everything else is ignored. */
interface OEmbedResponse {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
}

/**
 * How the provider asks YouTube what a video is called.
 *
 * Injected rather than called directly so the tests can answer for it. The
 * default reaches the network; nothing in the automated suite uses the default.
 */
export type OEmbedFetch = (videoId: string) => Promise<OEmbedResponse | null>;

const OEMBED = 'https://www.youtube.com/oembed';

/**
 * The real lookup. Public oEmbed — no API key, no quota, no account.
 *
 * Returns `null` for "YouTube says there is no such video" (404/401) and
 * *throws* for "the lookup did not happen". The caller turns those into
 * `unavailable` and `unreachable` respectively, and the distinction is the
 * whole reason this returns two different ways.
 */
export const fetchOEmbed: OEmbedFetch = async (videoId) => {
  const url = `${OEMBED}?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  const response = await fetch(url);
  if (response.status === 404 || response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`oEmbed answered ${response.status}`);
  return (await response.json()) as OEmbedResponse;
};

/** Only strings that say something become fields. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface YouTubeProviderOptions {
  fetchOEmbed?: OEmbedFetch;
}

export class YouTubeProvider implements MediaProvider {
  private readonly lookup: OEmbedFetch;

  constructor(options: YouTubeProviderOptions = {}) {
    this.lookup = options.fetchOEmbed ?? fetchOEmbed;
  }

  /**
   * The title comes from the video and is never typed — §14.
   *
   * The prototype had a text field next to the URL box, defaulting to
   * "Untitled", and the library filled up with songs called Untitled. A title
   * someone can type is a title someone will not type.
   *
   * **`durationMs` is deliberately absent.** oEmbed does not report it, and the
   * honest answer here is "not known yet" rather than a guess: length arrives
   * from the player, after loading, via `durationMs()`. A duration read before
   * the metadata loaded is one of the three ways a chart comes to outlive its
   * song (`PLAYTEST-FINDINGS.md` §7), so this refuses to invent one.
   */
  async resolve(input: string): Promise<MediaSource> {
    const providerMediaId = youTubeVideoId(input);
    if (!providerMediaId) {
      throw new MediaResolveError(
        'unrecognised',
        'That does not look like a YouTube link.',
        'Paste the address from the video page, or the link from Share.',
      );
    }

    let data: OEmbedResponse | null;
    try {
      data = await this.lookup(providerMediaId);
    } catch {
      throw new MediaResolveError(
        'unreachable',
        'Could not reach YouTube to look that video up.',
        'The link is probably fine — check the connection and try again.',
      );
    }

    if (!data) {
      throw new MediaResolveError(
        'unavailable',
        'YouTube has no video with that id.',
        'It may be private or deleted. Try another upload of the song.',
      );
    }

    const title = text(data.title);
    if (!title) {
      // A video with no title is not a video this can name, and §14 forbids
      // falling back to something typed. Better to refuse the add than to
      // create another song called Untitled.
      throw new MediaResolveError(
        'unavailable',
        'YouTube did not give that video a title.',
        'Try another upload of the song.',
      );
    }

    const source: MediaSource = { provider: 'youtube', providerMediaId, title };
    const creator = text(data.author_name);
    if (creator) source.creator = creator;
    const thumbnailUrl = text(data.thumbnail_url);
    if (thumbnailUrl) source.thumbnailUrl = thumbnailUrl;
    return source;
  }
}
