/**
 * HTTP for the Phase 3 store. Cookie identity on every request.
 *
 * Vite proxies `/api` onto this process so the browser stays same-origin
 * and the httpOnly cookie is first-party. There is no public leaderboard;
 * a score write is a person's own history.
 *
 * The request/response shapes are structural, not Node's. `tsc -b` typechecks
 * this folder with the browser tsconfig, and importing `node:http` there
 * would fail for a reason that has nothing to do with the handler.
 */
import {
  asId,
  validateRoundResult,
  type BeatmapId,
  type RevisionId,
} from '@neko/protocol';
import { resolveIdentity } from '../identity/resolve.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import type { Store } from '../store.ts';
import type { RoomHub } from '../rooms/hub.ts';

const MAX_BODY = 64 * 1024;

export interface HttpRequest {
  method?: string;
  url?: string;
  headers: { cookie?: string | undefined; [key: string]: string | string[] | undefined };
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
}

export interface HttpResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body?: string): void;
}

export async function handleApi(
  req: HttpRequest,
  res: HttpResponse,
  store: Store,
  options: { secure: boolean; hub?: RoomHub },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {});
    res.end();
    return;
  }

  const identity = await resolveIdentity(store, headerString(req.headers.cookie), {
    secure: options.secure,
  });
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (identity.setCookie) headers['set-cookie'] = identity.setCookie;

  try {
    if (method === 'GET' && path === '/api/me') {
      return send(res, 200, headers, identity.user);
    }

    if (method === 'PATCH' && path === '/api/me') {
      const body = await readJson(req);
      const user = await store.renameUser(identity.user.id, (body as { displayName?: unknown }).displayName);
      return send(res, 200, headers, user);
    }

    if (method === 'GET' && path === '/api/library') {
      const all = url.searchParams.get('all') === '1';
      return send(res, 200, headers, all ? await store.listAll() : await store.listPublished());
    }

    if (method === 'GET' && path === '/api/rooms') {
      return send(res, 200, headers, options.hub?.listing() ?? []);
    }

    if (method === 'POST' && path === '/api/charts') {
      const body = (await readJson(req)) as {
        providerMediaId?: unknown;
        title?: unknown;
        artist?: unknown;
        durationMs?: unknown;
        thumbnailUrl?: unknown;
        timing?: unknown;
        notes?: unknown;
      };
      const mediaId = typeof body.providerMediaId === 'string' ? body.providerMediaId.trim() : '';
      if (!mediaId) return send(res, 400, headers, { error: 'A YouTube id is required.' });
      const durationMs =
        typeof body.durationMs === 'number' && Number.isFinite(body.durationMs) && body.durationMs > 0
          ? Math.round(body.durationMs)
          : 90_000;
      const existing = await store.findSongByMedia('youtube', mediaId);
      const song =
        existing ??
        (await store.createSong({
          provider: 'youtube',
          providerMediaId: mediaId,
          title: body.title,
          artist: body.artist,
          durationMs,
          ...(typeof body.thumbnailUrl === 'string' ? { thumbnailUrl: body.thumbnailUrl } : {}),
        }));
      const beatmap = await store.createBeatmap({
        songId: song.id,
        authorId: identity.user.id,
        title: typeof body.title === 'string' ? body.title : song.title,
        difficulty: 'normal',
      });
      const revision = await store.writeRevision(beatmap.id, {
        timing: body.timing,
        notes: body.notes,
      });
      return send(res, 201, headers, { song, beatmap, revision });
    }

    const publish = /^\/api\/beatmaps\/([^/]+)\/publish$/.exec(path);
    if (method === 'POST' && publish) {
      const id = asId<BeatmapId>(publish[1]);
      if (!id) return send(res, 400, headers, { error: 'That id is not a uuid.' });
      const beatmap = await store.publish(id);
      return send(res, 200, headers, beatmap);
    }

    const playable = /^\/api\/playable\/([^/]+)$/.exec(path);
    if (method === 'GET' && playable) {
      const id = asId<RevisionId>(playable[1]);
      if (!id) return send(res, 400, headers, { error: 'That id is not a uuid.' });
      const chart = await store.getPlayable(id);
      if (!chart) return send(res, 404, headers, { error: 'No such chart.' });
      return send(res, 200, headers, chart);
    }

    if (method === 'POST' && path === '/api/scores') {
      const body = await readJson(req);
      const revisionId = asId<RevisionId>((body as { revisionId?: unknown }).revisionId);
      if (!revisionId) return send(res, 400, headers, { error: '`revisionId` must be a uuid.' });
      const checked = validateRoundResult((body as { result?: unknown }).result);
      if (!checked.ok) return send(res, 400, headers, { error: checked.errors.join(' | ') });
      const stored = await store.recordScore(identity.user.id, revisionId, checked.value);
      return send(res, 201, headers, stored);
    }

    send(res, 404, headers, { error: 'Not found.' });
  } catch (err) {
    if (err instanceof NotFoundError) return send(res, 404, headers, { error: err.message });
    if (err instanceof ConflictError) return send(res, 409, headers, { error: err.message });
    if (err instanceof ValidationError) return send(res, 400, headers, { error: err.message });
    send(res, 500, headers, { error: 'The server could not handle that.' });
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join('; ');
  return undefined;
}

function send(res: HttpResponse, status: number, headers: Record<string, string>, body: unknown): void {
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readJson(req: AsyncIterable<Uint8Array | string>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.byteLength;
    if (size > MAX_BODY) throw new ValidationError(['Body is too large.']);
    chunks.push(bytes);
  }
  if (size === 0) return {};
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    throw new ValidationError(['Body must be JSON.']);
  }
}
