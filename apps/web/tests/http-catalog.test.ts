/**
 * The catalog, over a fake transport. The play page uses `fetch`; this
 * file must not — the determinism gate reads every test and bans reaching.
 */
import { describe, expect, it } from 'vitest';
import { SEED_REVISION_ID } from '@neko/server';
import { HttpCatalog, type HttpSend } from '../src/play/HttpCatalog.ts';
import type { BeatmapId, UserId } from '@neko/protocol';

const DRAFT_BEATMAP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as BeatmapId;

function replies(table: Record<string, { status: number; body: unknown }>): {
  send: HttpSend;
  calls: Array<{ method: string; path: string; body?: unknown }>;
} {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  return {
    calls,
    send: async (input) => {
      calls.push(input);
      const hit = table[`${input.method} ${input.path}`];
      return hit ?? { status: 404, body: { error: 'no fixture' } };
    },
  };
}

describe('HttpCatalog', () => {
  it('lists what the server listed, and loads a playable by id', async () => {
    const { send } = replies({
      'GET /api/library': {
        status: 200,
        body: [{ title: 'Tutorial', revisionId: SEED_REVISION_ID, noteCount: 4 }],
      },
      [`GET /api/playable/${SEED_REVISION_ID}`]: {
        status: 200,
        body: { revision: { id: SEED_REVISION_ID, notes: [1, 2, 3, 4] } },
      },
    });
    const catalog = new HttpCatalog(send);
    const listed = await catalog.listPublished();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('Tutorial');

    const chart = await catalog.getPlayable(SEED_REVISION_ID);
    expect(chart?.revision.notes).toHaveLength(4);
  });

  it('lists the whole shelf, rooms, and a created draft', async () => {
    const { send, calls } = replies({
      'GET /api/library?all=1': {
        status: 200,
        body: [{ title: 'Draft', status: 'draft' }],
      },
      'GET /api/rooms': {
        status: 200,
        body: [{ id: 'public', occupants: 2, cap: 6 }],
      },
      'POST /api/charts': {
        status: 201,
        body: { beatmap: { id: 'b1', status: 'draft' }, revision: { id: 'r1' } },
      },
      [`POST /api/beatmaps/${DRAFT_BEATMAP}/publish`]: {
        status: 200,
        body: { id: DRAFT_BEATMAP, status: 'published' },
      },
    });
    const catalog = new HttpCatalog(send);
    const shelf = await catalog.listAll();
    expect(shelf[0]?.status).toBe('draft');
    expect(await catalog.listRooms()).toEqual([{ id: 'public', occupants: 2, cap: 6 }]);

    const created = await catalog.createChart({
      providerMediaId: 'dQw4w9WgXcQ',
      title: 'Song',
      timing: [],
      notes: [],
    });
    expect(created.beatmap.status).toBe('draft');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/charts')).toBe(true);

    const published = await catalog.publishBeatmap(DRAFT_BEATMAP);
    expect(published.status).toBe('published');
  });

  it('treats a missing playable as null, not an exception', async () => {
    const { send } = replies({
      'GET /api/playable/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee': {
        status: 404,
        body: { error: 'No such chart.' },
      },
    });
    const catalog = new HttpCatalog(send);
    await expect(
      catalog.getPlayable('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' as typeof SEED_REVISION_ID),
    ).resolves.toBeNull();
  });

  it('posts a score without sending the caller\'s user id — the cookie is the person', async () => {
    const { send, calls } = replies({
      'POST /api/scores': {
        status: 201,
        body: { id: 'score-1', result: { score: 61 } },
      },
    });
    const catalog = new HttpCatalog(send);
    const stored = await catalog.recordScore(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UserId,
      SEED_REVISION_ID,
      {
        score: 61,
        combo: 4,
        accuracy: 1,
        health: 100,
        maxCombo: 4,
        counts: { PERFECT: 4, GREAT: 0, GOOD: 0, OKAY: 0, MISS: 0 },
        completed: true,
      },
    );
    expect(stored.result.score).toBe(61);
    expect(calls[0]?.body).toEqual({
      revisionId: SEED_REVISION_ID,
      result: expect.objectContaining({ score: 61 }),
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});
