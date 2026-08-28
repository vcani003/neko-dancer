/**
 * Reading a link, and asking YouTube what it is.
 *
 * The parsing half is exhaustive on purpose: every accepted shape here is one
 * a person has actually pasted, and every rejected one is a near-miss that
 * would otherwise become an eleven-character id that does not exist.
 */
import { describe, expect, it } from 'vitest';
import { MediaResolveError } from '../src/playback/MediaProvider.ts';
import type { OEmbedFetch } from '../src/playback/YouTubeProvider.ts';
import { YouTubeProvider, youTubeVideoId } from '../src/playback/YouTubeProvider.ts';

const ID = 'dQw4w9WgXcQ';

describe('youTubeVideoId — the shapes people paste', () => {
  it.each([
    ['the desktop URL', `https://www.youtube.com/watch?v=${ID}`],
    ['without the scheme', `youtube.com/watch?v=${ID}`],
    ['without www', `https://youtube.com/watch?v=${ID}`],
    ['the mobile site', `https://m.youtube.com/watch?v=${ID}`],
    ['music', `https://music.youtube.com/watch?v=${ID}`],
    ['a share link', `https://youtu.be/${ID}`],
    ['a share link with a timestamp', `https://youtu.be/${ID}?t=42`],
    ['an embed src copied from a page', `https://www.youtube.com/embed/${ID}`],
    ['a Shorts link', `https://www.youtube.com/shorts/${ID}`],
    ['a live link', `https://www.youtube.com/live/${ID}`],
    ['the old /v/ form', `https://www.youtube.com/v/${ID}`],
    ['a bare id', ID],
    ['a bare id with whitespace around it', `  ${ID}\n`],
    ['extra query parameters', `https://www.youtube.com/watch?list=PL1&v=${ID}&index=2`],
  ])('reads the id from %s', (_label, input) => {
    expect(youTubeVideoId(input)).toBe(ID);
  });

  it.each([
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['a sentence', 'the one with the cat'],
    ['another site', 'https://vimeo.com/123456789'],
    ['a YouTube page that is not a video', 'https://www.youtube.com/results?search_query=cat'],
    ['a channel', 'https://www.youtube.com/@someone'],
    ['an id one character short', 'dQw4w9WgXc'],
    ['an id one character long', 'dQw4w9WgXcQQ'],
    ['an id with a character ids cannot contain', 'dQw4w9WgX!Q'],
    ['a watch URL with a malformed v', 'https://www.youtube.com/watch?v=nope'],
  ])('refuses %s', (_label, input) => {
    expect(youTubeVideoId(input)).toBeNull();
  });

  it('does not mistake a longer path segment for an id', () => {
    // `youtu.be/dQw4w9WgXcQextra` is not a link to dQw4w9WgXcQ.
    expect(youTubeVideoId(`https://youtu.be/${ID}extra`)).toBeNull();
  });
});

describe('YouTubeProvider.resolve', () => {
  it('names the song from the video, never from a field — §14', async () => {
    const provider = new YouTubeProvider({
      fetchOEmbed: async () => ({
        title: 'Some Song (Official Video)',
        author_name: 'A Band',
        thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg',
      }),
    });

    await expect(provider.resolve(`https://youtu.be/${ID}`)).resolves.toEqual({
      provider: 'youtube',
      providerMediaId: ID,
      title: 'Some Song (Official Video)',
      creator: 'A Band',
      thumbnailUrl: 'https://i.ytimg.com/vi/x/hq.jpg',
    });
  });

  it('carries no id of its own — ADR-006', async () => {
    const provider = new YouTubeProvider({ fetchOEmbed: async () => ({ title: 'Song' }) });
    const source = await provider.resolve(ID);
    expect(Object.keys(source)).not.toContain('id');
  });

  it('leaves durationMs absent rather than guessing it', async () => {
    // oEmbed does not report length. A duration invented here is one of the
    // ways a chart comes to outlive its song.
    const provider = new YouTubeProvider({ fetchOEmbed: async () => ({ title: 'Song' }) });
    const source = await provider.resolve(ID);
    expect(source.durationMs).toBeUndefined();
  });

  it('omits creator and thumbnail rather than carrying empty ones', async () => {
    const provider = new YouTubeProvider({
      fetchOEmbed: async () => ({ title: 'Song', author_name: '  ', thumbnail_url: 42 }),
    });
    const source = await provider.resolve(ID);
    expect(source).toEqual({ provider: 'youtube', providerMediaId: ID, title: 'Song' });
  });

  it('never looks anything up for a link it cannot read', async () => {
    let looked = false;
    const provider = new YouTubeProvider({
      fetchOEmbed: async () => {
        looked = true;
        return { title: 'Song' };
      },
    });

    await expect(provider.resolve('https://vimeo.com/1')).rejects.toBeInstanceOf(MediaResolveError);
    expect(looked).toBe(false);
  });

  const named: ReadonlyArray<readonly [string, OEmbedFetch, string]> = [
    ['unrecognised', async () => ({ title: 'Song' }), 'https://vimeo.com/1'],
    ['unavailable', async () => null, `https://youtu.be/${ID}`],
    [
      'unreachable',
      async () => {
        throw new Error('offline');
      },
      `https://youtu.be/${ID}`,
    ],
  ];

  it.each(named)('reports %s', async (reason, fetchOEmbed, input) => {
    const provider = new YouTubeProvider({ fetchOEmbed });
    await expect(provider.resolve(input)).rejects.toMatchObject({ reason });
  });

  it('does not blame the link when the lookup itself failed', async () => {
    // The distinction that costs real time: told "unavailable", someone goes
    // hunting for another upload of a song that was fine all along.
    const provider = new YouTubeProvider({
      fetchOEmbed: async () => {
        throw new Error('network');
      },
    });
    const error = await provider.resolve(ID).catch((e: MediaResolveError) => e);
    expect(error).toBeInstanceOf(MediaResolveError);
    expect((error as MediaResolveError).reason).toBe('unreachable');
    expect((error as MediaResolveError).hint).toMatch(/link is probably fine/i);
  });

  it('refuses a video with no title rather than inventing one', async () => {
    const provider = new YouTubeProvider({ fetchOEmbed: async () => ({ title: '   ' }) });
    await expect(provider.resolve(ID)).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('every failure carries something the person can act on', async () => {
    const cases: Array<[OEmbedFetch, string]> = [
      [async () => null, `https://youtu.be/${ID}`],
    ];
    for (const [fetchOEmbed, input] of cases) {
      const provider = new YouTubeProvider({ fetchOEmbed });
      const error = (await provider.resolve(input).catch((e) => e)) as MediaResolveError;
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.hint.length).toBeGreaterThan(0);
    }
  });
});
