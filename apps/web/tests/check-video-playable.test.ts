/**
 * The lobby preflight: can THIS browser play this video?
 *
 * Restrictions are per-viewer — region, age, and the uploader's embedding
 * setting — so the answer cannot be looked up once and shared. The value is in
 * *when* it runs: a restriction found in the lobby is a row in the player list,
 * and the same restriction found during the countdown has already wasted
 * everyone's time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkVideoPlayable } from '../src/playback/checkVideoPlayable.ts';
import { fakeDocument, fakeYouTubeApi, flush, withFakeWindow } from './fakes.ts';

beforeEach(() => {
  withFakeWindow();
});

const doc = () => fakeDocument() as unknown as Document;

describe('answering', () => {
  it('is ok when the video loads and stays loaded', async () => {
    vi.useFakeTimers();
    try {
      const api = fakeYouTubeApi();
      const check = checkVideoPlayable('dQw4w9WgXcQ', { api, doc: doc(), settleMs: 100 });
      await flush();
      api.last().emitReady();
      await vi.advanceTimersByTimeAsync(150);

      await expect(check).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('catches the refusal that arrives AFTER ready', async () => {
    // An embedding-blocked video reports ready and then fails. Answering on
    // ready alone would call it playable and the discovery would move into the
    // countdown, which is the whole thing this exists to prevent.
    vi.useFakeTimers();
    try {
      const api = fakeYouTubeApi();
      const check = checkVideoPlayable('dQw4w9WgXcQ', { api, doc: doc(), settleMs: 500 });
      await flush();
      api.last().emitReady();
      await vi.advanceTimersByTimeAsync(200);
      api.last().emitError(150);
      await vi.advanceTimersByTimeAsync(500);

      const result = await check;
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(150);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the code, so the reason survives to the player list', async () => {
    const api = fakeYouTubeApi();
    const check = checkVideoPlayable('dQw4w9WgXcQ', { api, doc: doc() });
    await flush();
    api.last().emitError(100);

    const result = await check;
    expect(result.error?.message).toMatch(/private, deleted, or not available/i);
    expect(result.error?.hint.length).toBeGreaterThan(0);
  });

  it('treats a malformed id as code 2 rather than throwing', async () => {
    const api = fakeYouTubeApi({ throwOnConstruct: new Error('Invalid video id') });
    const result = await checkVideoPlayable('nope', { api, doc: doc() });
    expect(result).toMatchObject({ ok: false, error: { code: 2 } });
  });
});

describe('when the check itself cannot run', () => {
  it('says ok rather than blaming the video', async () => {
    // "This song is blocked for you" would be a lie that outlives the network
    // blip that caused it. Optimism fails loudly for one person later, instead
    // of quietly excluding everybody over a script that did not load.
    const result = await checkVideoPlayable('dQw4w9WgXcQ', {
      api: () => Promise.reject(new Error('offline')),
      doc: doc(),
    });
    expect(result).toEqual({ ok: true });
  });

  it('always answers, even when nothing ever happens', async () => {
    // A check that never returns leaves the lobby waiting forever.
    vi.useFakeTimers();
    try {
      const api = fakeYouTubeApi();
      const check = checkVideoPlayable('dQw4w9WgXcQ', { api, doc: doc(), settleMs: 100 });
      await flush();
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(check).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('leaving nothing behind', () => {
  it('destroys the hidden player and removes its mount', async () => {
    const api = fakeYouTubeApi();
    const document_ = fakeDocument();
    const check = checkVideoPlayable('dQw4w9WgXcQ', {
      api,
      doc: document_ as unknown as Document,
    });
    await flush();
    api.last().emitError(2);
    await check;

    expect(api.last().destroyed).toBe(true);
    expect(document_.body.children[0]?.attributes['aria-hidden']).toBe('true');
  });

  it('mounts somewhere invisible — nothing is shown and nothing is heard', async () => {
    const api = fakeYouTubeApi();
    const document_ = fakeDocument();
    const check = checkVideoPlayable('dQw4w9WgXcQ', {
      api,
      doc: document_ as unknown as Document,
    });
    await flush();
    api.last().emitError(2);
    await check;

    expect(document_.body.children[0]?.style.cssText).toMatch(/opacity:0/);
  });
});
