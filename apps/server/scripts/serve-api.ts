/**
 * Store + Public/Staging rooms on 5182. Vite proxies `/api` and `/ws`.
 *
 *     npm run api
 *     npm run dev
 *     open http://<hostname>.local:5180/
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { asId, parseClientMessage, type RevisionId } from '@neko/protocol';
import { openFileDb } from '../src/db/client.ts';
import { handleApi } from '../src/http/api.ts';
import { resolveIdentity } from '../src/identity/resolve.ts';
import { RoomHub, PUBLIC_ROOM_ID, STAGING_ROOM_ID } from '../src/rooms/hub.ts';
import { seedLibrary } from '../src/seed.ts';
import { Store } from '../src/store.ts';

const PORT = Number(process.env.API_PORT ?? 5182);
const HOST = process.env.API_HOST ?? '127.0.0.1';
const DATA_DIR = resolve(fileURLToPath(new URL('../.data/pglite', import.meta.url)));

mkdirSync(dirname(DATA_DIR), { recursive: true });
const { db } = await openFileDb(DATA_DIR);
const store = new Store(db);
await seedLibrary(store);
const hub = new RoomHub();

const server = createServer((req, res) => {
  void handleApi(req, res, store, { secure: false, hub });
});

const sockets = new WebSocketServer({ server, path: '/ws' });
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

sockets.on('connection', (socket, req) => {
  void sit(socket, req);
});

async function sit(socket: WebSocket, req: { headers: { cookie?: string | undefined } }): Promise<void> {
  const identity = await resolveIdentity(store, req.headers.cookie, { secure: false });
  let seated = false;

  const send = (payload: unknown) => {
    if (socket.readyState === socket.OPEN) socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };

  send({ type: 'welcome', user: identity.user });

  socket.on('message', (raw) => {
    let data: unknown;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    const rawType = data && typeof data === 'object' ? (data as { type?: unknown }).type : undefined;

    // Public advances on finish or an explicit next. Do not wait for a
    // valid score payload — a refused finish used to leave the room stuck.
    if (rawType === 'finish' || rawType === 'next') {
      if (rawType === 'finish') hub.finish(identity.user.id);
      const nudge = hub.advancePublic(identity.user.id);
      if (nudge?.start) void startRound(nudge.roomId);
      return;
    }

    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      send({ type: 'error', error: parsed.errors[0] ?? 'That message is unusable.' });
      return;
    }
    const message = parsed.value;

    if (message.type === 'join') {
      const roomId = message.roomId;
      const extra = data as { revisionId?: unknown };
      const revisionId = asId<RevisionId>(extra.revisionId) ?? undefined;
      const result = hub.join(roomId, identity.user, send, revisionId);
      if (!result.ok) {
        send({ type: 'error', error: result.error });
        return;
      }
      seated = true;
      if (result.catchup) {
        send({
          type: 'round',
          revisionId: result.catchup.revisionId,
          countdownMs: result.catchup.countdownMs,
        });
      }
      if (result.spectate) {
        send({
          type: 'round',
          revisionId: result.spectate.revisionId,
          spectate: true,
          elapsedMs: result.spectate.elapsedMs,
        });
      }
      if (result.start) void startRound(result.roomId);
      return;
    }

    if (message.type === 'chat') {
      hub.chat(identity.user.id, message.text);
      return;
    }

    if (message.type === 'ready') {
      const outcome = hub.ready(identity.user.id, message.ready);
      if (outcome?.allReady) void startRound(outcome.roomId);
      return;
    }

    if (message.type === 'leave') {
      const left = hub.leave(identity.user.id, send);
      seated = false;
      if (left.emptied && left.roomId) clearTimers(left.roomId);
      else if (left.startNext && left.roomId) queueNext(left.roomId);
    }
  });

  socket.on('close', () => {
    if (!seated) return;
    const left = hub.leave(identity.user.id, send);
    if (left.emptied && left.roomId) clearTimers(left.roomId);
    else if (left.startNext && left.roomId) queueNext(left.roomId);
  });
}

function queueNext(roomId: string): void {
  if (roomId !== PUBLIC_ROOM_ID) return;
  clearTimers(roomId);
  void startRound(roomId);
}

async function startRound(roomId: string): Promise<void> {
  try {
    await startRoundInner(roomId);
  } catch {
    hub.abortArming(roomId);
  }
}

async function startRoundInner(roomId: string): Promise<void> {
  let revisionId = roomId === STAGING_ROOM_ID ? hub.stagingRevision() : null;
  let durationMs = 180_000;
  if (roomId === PUBLIC_ROOM_ID) {
    const published = await store.listPublished();
    if (published.length === 0) {
      hub.abortArming(roomId);
      return;
    }
    const pick = published[hub.nextShuffleIndex() % published.length];
    revisionId = pick?.revisionId ?? null;
    durationMs = pick?.durationMs ?? durationMs;
  } else if (revisionId) {
    const chart = await store.getPlayable(revisionId);
    durationMs = chart?.song.durationMs ?? durationMs;
  }
  if (!revisionId) {
    hub.abortArming(roomId);
    return;
  }
  const countdownMs = hub.countdownMs(roomId);
  if (!hub.beginCountdown(roomId, revisionId, countdownMs)) return;
  clearTimers(roomId);
  hub.announce(roomId, {
    type: 'round',
    revisionId,
    countdownMs,
  });
  later(roomId, countdownMs, () => {
    hub.markPlaying(roomId);
  });
  later(roomId, countdownMs + durationMs + 2_000, () => {
    if (hub.expire(roomId).startNext) queueNext(roomId);
  });
}

function later(roomId: string, ms: number, fn: () => void): void {
  const id = setTimeout(fn, ms);
  const list = timers.get(roomId) ?? [];
  list.push(id);
  timers.set(roomId, list);
}

function clearTimers(roomId: string): void {
  for (const id of timers.get(roomId) ?? []) clearTimeout(id);
  timers.delete(roomId);
}

server.listen(PORT, HOST, () => {
  console.log(`neko api  http://${HOST}:${PORT}`);
  console.log('proxied from vite as /api and /ws — open http://<hostname>.local:5180/');
});
