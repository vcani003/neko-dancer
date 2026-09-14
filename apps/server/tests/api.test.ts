/**
 * The store, over HTTP. Cookie in, library out, score claimed.
 *
 * Requests are faked rather than listened-for: a port would make this a
 * test of Node, and the handler is the thing we own.
 */
import { describe, expect, it } from 'vitest';
import { handleApi, RoomHub, type HttpRequest, type HttpResponse } from '@neko/server';
import { SEED_REVISION_ID, seedLibrary } from '@neko/server';
import { IDENTITY_COOKIE } from '@neko/server';
import { aRound, openTestStore, tap, timing } from './helpers.ts';

interface Recorded {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

function request(over: {
  method?: string;
  url: string;
  cookie?: string;
  body?: unknown;
}): HttpRequest {
  const payload = over.body === undefined ? '' : JSON.stringify(over.body);
  async function* chunks(): AsyncGenerator<Uint8Array> {
    if (payload) yield new TextEncoder().encode(payload);
  }
  return {
    method: over.method ?? 'GET',
    url: over.url,
    headers: { cookie: over.cookie },
    [Symbol.asyncIterator]: chunks,
  };
}

function capture(): { res: HttpResponse; recorded: Recorded } {
  const recorded: Recorded = { status: 0, headers: {}, body: null };
  return {
    recorded,
    res: {
      writeHead(status, headers) {
        recorded.status = status;
        recorded.headers = headers;
      },
      end(body) {
        recorded.body = body ? JSON.parse(body) : null;
      },
    },
  };
}

async function call(
  store: Awaited<ReturnType<typeof openTestStore>>['store'],
  input: Parameters<typeof request>[0],
  hub?: RoomHub,
): Promise<Recorded> {
  const { res, recorded } = capture();
  await handleApi(request(input), res, store, { secure: false, hub });
  return recorded;
}

function cookieOf(recorded: Recorded): string | undefined {
  const set = recorded.headers['set-cookie'];
  if (!set) return undefined;
  return set.split(';')[0];
}

describe('identity', () => {
  it('mints a person on the first /api/me and reuses them on the next', async () => {
    const { store } = await openTestStore();
    const first = await call(store, { url: '/api/me' });
    expect(first.status).toBe(200);
    expect(first.headers['set-cookie']).toContain(IDENTITY_COOKIE);
    expect(first.headers['set-cookie']).toContain('HttpOnly');
    const id = (first.body as { id: string }).id;

    const again = await call(store, { url: '/api/me', cookie: cookieOf(first) });
    expect(again.status).toBe(200);
    expect(again.headers['set-cookie']).toBeUndefined();
    expect((again.body as { id: string }).id).toBe(id);
  });

  it('renames that person', async () => {
    const { store } = await openTestStore();
    const me = await call(store, { url: '/api/me' });
    const renamed = await call(store, {
      method: 'PATCH',
      url: '/api/me',
      cookie: cookieOf(me),
      body: { displayName: 'Vero' },
    });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { displayName: string }).displayName).toBe('Vero');
  });
});

describe('the library', () => {
  it('lists the seeded tutorial and serves its notes', async () => {
    const { store } = await openTestStore();
    await seedLibrary(store);

    const listed = await call(store, { url: '/api/library' });
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Tutorial', noteCount: 4, revisionId: SEED_REVISION_ID }),
      ]),
    );

    const chart = await call(store, { url: `/api/playable/${SEED_REVISION_ID}` });
    expect(chart.status).toBe(200);
    expect((chart.body as { revision: { notes: unknown[] } }).revision.notes).toHaveLength(4);
  });

  it('refuses a playable id that is not a uuid, and 404s a missing one', async () => {
    const { store } = await openTestStore();
    const bad = await call(store, { url: '/api/playable/not-a-uuid' });
    expect(bad.status).toBe(400);

    const missing = await call(store, { url: '/api/playable/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    expect(missing.status).toBe(404);
  });
});

describe('scores', () => {
  it('stores a self-reported result under the cookie, not a body user id', async () => {
    const { store } = await openTestStore();
    await seedLibrary(store);
    const me = await call(store, { url: '/api/me' });
    const userId = (me.body as { id: string }).id;

    const stored = await call(store, {
      method: 'POST',
      url: '/api/scores',
      cookie: cookieOf(me),
      body: { revisionId: SEED_REVISION_ID, result: aRound({ score: 61 }) },
    });
    expect(stored.status).toBe(201);
    expect(stored.body).toEqual(
      expect.objectContaining({
        userId,
        revisionId: SEED_REVISION_ID,
        result: expect.objectContaining({ score: 61 }),
      }),
    );
  });

  it('refuses a result that is not a result', async () => {
    const { store } = await openTestStore();
    await seedLibrary(store);
    const me = await call(store, { url: '/api/me' });
    const refused = await call(store, {
      method: 'POST',
      url: '/api/scores',
      cookie: cookieOf(me),
      body: { revisionId: SEED_REVISION_ID, result: { score: 'lots' } },
    });
    expect(refused.status).toBe(400);
  });
});

describe('drafts, publish, and rooms', () => {
  it('keeps a new chart off the public list until it is published', async () => {
    const { store } = await openTestStore();
    await seedLibrary(store);
    const me = await call(store, { url: '/api/me' });
    const created = await call(store, {
      method: 'POST',
      url: '/api/charts',
      cookie: cookieOf(me),
      body: {
        providerMediaId: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        timing: timing(),
        notes: [tap()],
      },
    });
    expect(created.status).toBe(201);
    const beatmapId = (created.body as { beatmap: { id: string; status: string } }).beatmap.id;
    expect((created.body as { beatmap: { status: string } }).beatmap.status).toBe('draft');

    const published = await call(store, { url: '/api/library' });
    expect(JSON.stringify(published.body)).not.toContain('Never Gonna Give You Up');

    const all = await call(store, { url: '/api/library?all=1' });
    expect(all.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Never Gonna Give You Up', status: 'draft' })]),
    );

    const publishedNow = await call(store, {
      method: 'POST',
      url: `/api/beatmaps/${beatmapId}/publish`,
      cookie: cookieOf(me),
    });
    expect(publishedNow.status).toBe(200);
    expect((publishedNow.body as { status: string }).status).toBe('published');

    const listed = await call(store, { url: '/api/library' });
    expect(listed.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Never Gonna Give You Up', status: 'published' })]),
    );
  });

  it('lists the public room from the hub', async () => {
    const { store } = await openTestStore();
    const hub = new RoomHub();
    const listed = await call(store, { url: '/api/rooms' }, hub);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: 'public', cap: 6, occupants: 0 })]);
  });
});

describe('unknown routes', () => {
  it('404s', async () => {
    const { store } = await openTestStore();
    const res = await call(store, { url: '/api/nope' });
    expect(res.status).toBe(404);
  });
});
