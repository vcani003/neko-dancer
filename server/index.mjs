/**
 * The game server: static files plus a WebSocket room layer.
 *
 * Bound to every interface so anyone on the same network can play by opening
 * this machine's address. The startup banner prints the exact URL to share,
 * because "find your IP" is a worse instruction than a link.
 *
 * Deliberately small. Rooms live in memory and vanish when empty; there is no
 * database, no accounts and no persistence yet. Those arrive when there is
 * something worth persisting, not before.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { C2S, COUNTDOWN_MS, S2C } from './protocol.mjs';
import { RoomRegistry, cleanChat, cleanName } from './rooms.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const PORT = Number(process.env.PORT ?? 5181);

/**
 * Which interface to listen on.
 *
 * Defaults to every interface, because the point is that other people can
 * join — but that means anyone who can reach this machine can reach this
 * server, and on a shared or public network that is everyone. HOST=127.0.0.1
 * restricts it to this machine when that is not wanted.
 */
const HOST = process.env.HOST ?? '0.0.0.0';

// ---- limits ----
//
// Every one of these exists because the alternative is unbounded. A room this
// small does not need to survive a determined attacker, but it should not fall
// over to an accident or a bored guest either.
/**
 * Message size cap.
 *
 * Sized against the largest thing the game legitimately sends, which is a
 * chart: a 366-arrow song is about 21 KB of JSON, and a long dense one can be
 * several times that. The 4 KB this started at was smaller than any real chart,
 * so pressing "I'm ready" crashed the server — a limit that rejects normal
 * traffic is not protection, it is an outage with a rationale.
 *
 * The real guard against an absurd chart is the arrow-count check on
 * PICK_SONG, which bounds what the message can contain rather than only how
 * big it is.
 */
const MAX_MESSAGE_BYTES = 512 * 1024;
const MAX_PLAYERS_PER_ROOM = 16;
const MAX_ROOMS = 32;
/** Messages per socket per window, beyond which the socket is closed. */
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 2000;
/**
 * What a client may claim went wrong, and how the room is told.
 *
 * A closed set, because the text is broadcast as a system message. Clients
 * choose a code; the server chooses the words.
 */
const TROUBLE_REASONS = {
  embedBlocked: 'the uploader does not allow that video outside YouTube.',
  badId: 'YouTube did not recognise that video link.',
  unavailable: 'that video is private, deleted, or blocked in their country.',
  playerFailed: "YouTube's player would not start on their machine.",
  unknown: 'the video would not load for them.',
};

/** A score above this is not a score, it is a claim worth ignoring. */
const MAX_PLAUSIBLE_SCORE = 5_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

const exists = (p) => stat(p).then((s) => s.isFile(), () => false);

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');

  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  // normalize collapses any ../ before the check, and the check compares
  // against dist WITH a trailing separator — without it, a sibling directory
  // named `dist-something` would pass a plain startsWith and escape the folder.
  const requested = normalize(join(dist, decoded));
  if (requested !== dist && !requested.startsWith(dist + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const candidate = (await exists(requested)) ? requested : join(dist, 'index.html');
  if (!(await exists(candidate))) {
    res.writeHead(404).end('Run `npm run build` first — there is no dist/ to serve.');
    return;
  }

  const body = await readFile(candidate);
  res.writeHead(200, {
    'content-type': MIME[extname(candidate)] ?? 'application/octet-stream',
    'content-length': body.length,
  }).end(body);
}

const server = createServer((req, res) => {
  serveStatic(req, res).catch((err) => {
    console.error('[http]', err);
    res.writeHead(500).end('Server error');
  });
});

/**
 * Only accept sockets from pages this server itself served.
 *
 * Without this any website the host visits could open a socket to this server
 * — the browser sends it willingly, because WebSockets are not subject to the
 * same-origin policy the way fetch is. That is cross-site WebSocket hijacking,
 * and on a LAN game server it means a random tab could join rooms, read chat
 * and post as whoever is running it.
 *
 * A missing Origin is allowed: non-browser clients do not send one, and the
 * threat here is specifically a browser being used against its owner.
 */
function originAllowed(origin, host) {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: ({ origin, req }) => originAllowed(origin, req.headers.host),
});
const rooms = new RoomRegistry();
let nextId = 1;

const send = (socket, type, payload) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, ...payload }));
};

const broadcast = (room, type, payload) => {
  for (const client of wss.clients) {
    if (client.roomId === room.id) send(client, type, payload);
  }
};

const publishRoom = (room) => broadcast(room, S2C.ROOM, { room: room.toJSON() });

/** Countdown timers, so a room leaving mid-count does not start a ghost round. */
const countdowns = new Map();

/**
 * Watchdogs that end a round nobody finished.
 *
 * A round ends when every player reports FINISH. A client that never reports —
 * a crashed tab, a song that failed to load, a laptop closed mid-verse —
 * leaves the room in `playing` forever, and READY is ignored in that state, so
 * the room is dead to everyone in it until the server restarts. Observed
 * exactly that way in testing, with a song whose video would not load.
 *
 * Any client can therefore brick a room by picking, readying and going quiet,
 * which is a denial of service that needs no malice to trigger.
 */
const roundTimers = new Map();
/**
 * Beyond the song's own length: buffering, a late start, a paused tab.
 * Overridable so a test can prove the watchdog without waiting a minute and a
 * half for it.
 */
const ROUND_GRACE_MS = Number(process.env.ROUND_GRACE_MS ?? 90_000);

function cancelCountdown(roomId) {
  const timer = countdowns.get(roomId);
  if (timer) {
    clearTimeout(timer);
    countdowns.delete(roomId);
  }
}

/**
 * Everyone is ready: count down, then start together.
 *
 * The chart travels with the go-ahead so a player who has never charted this
 * song can still play it — the room is the distribution mechanism, and a chart
 * is small enough that this costs nothing.
 */
/** End the round now, whatever state its players are in. */
function endRoundNow(room, reason) {
  clearRoundTimer(room.id);
  if (room.round.state !== 'playing' && room.round.state !== 'countdown') return;
  const awarded = room.endRound();
  broadcast(room, S2C.ROUND, { round: room.round, awarded });
  if (reason) broadcast(room, S2C.CHAT, { system: true, text: reason });
  publishRoom(room);
}

function clearRoundTimer(roomId) {
  const timer = roundTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    roundTimers.delete(roomId);
  }
}

function startCountdown(room) {
  if (countdowns.has(room.id)) return;

  const round = room.beginCountdown(COUNTDOWN_MS);
  broadcast(room, S2C.ROUND, { round, chart: room.chart });
  publishRoom(room);

  countdowns.set(
    room.id,
    setTimeout(() => {
      countdowns.delete(room.id);
      // The room may have emptied or someone may have left while counting.
      if (room.isEmpty()) return;
      broadcast(room, S2C.ROUND, { round: room.beginPlaying() });
      publishRoom(room);
      clearRoundTimer(room.id);
      roundTimers.set(
        room.id,
        setTimeout(
          () => endRoundNow(room, 'That round ran over — back to the lobby.'),
          room.chartDurationMs() + ROUND_GRACE_MS,
        ),
      );
    }, COUNTDOWN_MS),
  );
}

/**
 * A socket-level error must never reach Node's unhandled 'error' path.
 *
 * `ws` emits 'error' on the socket for protocol violations — an oversized
 * frame, a malformed one — and an unhandled 'error' event throws, which takes
 * the whole process down. That is how a payload cap became a way to kill the
 * server from any client, which is precisely backwards.
 */
wss.on('error', (err) => console.error('[wss]', err.message));

wss.on('connection', (socket) => {
  socket.on('error', (err) => {
    console.error('[socket]', err.message);
    // The connection is already unusable; closing it keeps one bad client from
    // affecting anyone else in the room.
    socket.close(1011, 'socket error');
  });

  socket.playerId = `p${nextId++}`;
  socket.roomId = null;
  socket.messageCount = 0;
  socket.windowStartedAt = Date.now();
  send(socket, S2C.WELCOME, { playerId: socket.playerId });

  /** Too many messages too fast is either a bug or an attack; both end here. */
  const withinRateLimit = () => {
    const now = Date.now();
    if (now - socket.windowStartedAt > RATE_WINDOW_MS) {
      socket.windowStartedAt = now;
      socket.messageCount = 0;
    }
    socket.messageCount += 1;
    return socket.messageCount <= RATE_LIMIT;
  };

  socket.on('message', (raw) => {
    if (!withinRateLimit()) {
      send(socket, S2C.ERROR, { error: 'Slow down.' });
      socket.close(1008, 'rate limit');
      return;
    }

    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send(socket, S2C.ERROR, { error: 'Malformed message.' });
      return;
    }
    if (typeof message !== 'object' || message === null) return;

    switch (message.type) {
      case C2S.JOIN: {
        // One room each. Rejoining without leaving would leave a ghost behind
        // and let one socket occupy several seats.
        if (socket.roomId) {
          send(socket, S2C.ERROR, { error: 'Already in a room.' });
          break;
        }
        if (rooms.size() >= MAX_ROOMS && !rooms.has(message.roomId)) {
          send(socket, S2C.ERROR, { error: 'Too many rooms open.' });
          break;
        }

        const room = rooms.get(message.roomId);
        if (room.playerCount >= MAX_PLAYERS_PER_ROOM) {
          send(socket, S2C.ERROR, { error: 'That room is full.' });
          break;
        }

        socket.roomId = room.id;
        const player = room.addPlayer(socket.playerId, message.name);
        broadcast(room, S2C.CHAT, { system: true, text: `${player.name} joined` });
        // Hand the newcomer whatever the room is already playing, so they can
        // see and select it rather than staring at their own charts.
        if (room.chart) send(socket, S2C.SONG, { chart: room.chart, pickedBy: room.pickedBy });
        publishRoom(room);
        break;
      }

      case C2S.CHAT: {
        if (!socket.roomId) break;
        const room = rooms.get(socket.roomId);
        const player = room.players.get(socket.playerId);
        const text = cleanChat(message.text);
        if (!player || !text) break;
        broadcast(room, S2C.CHAT, { from: player.name, text });
        break;
      }

      case C2S.SCORE: {
        if (!socket.roomId) break;
        const room = rooms.get(socket.roomId);
        // The score is a CLAIM, not a fact — the client computed it and could
        // have computed anything. Bounded here so a malformed or malicious
        // value cannot break the board, but this is not cheat-proof and is not
        // pretending to be. See docs/SECURITY.md: making it authoritative means
        // judging on the server, which needs the chart there too.
        if (Number(message.score) > MAX_PLAUSIBLE_SCORE) break;
        room.updateScore(socket.playerId, message);
        publishRoom(room);
        break;
      }

      case C2S.PICK_SONG: {
        if (!socket.roomId) break;
        const room = rooms.get(socket.roomId);
        if (room.round.state === 'countdown' || room.round.state === 'playing') break;
        // Charts arrive from players, so they are validated as data rather
        // than trusted: enough shape to be playable, and nothing enormous.
        const chart = message.chart;
        if (!chart || typeof chart !== 'object' || !Array.isArray(chart.arrows)) {
          send(socket, S2C.ERROR, { error: 'That chart could not be read.' });
          break;
        }
        if (chart.arrows.length > 5000) {
          send(socket, S2C.ERROR, { error: 'That chart is implausibly long.' });
          break;
        }
        const picker = room.players.get(socket.playerId);
        room.setChart(chart, picker?.name ?? 'someone');
        // The whole chart, once, to everyone: this is how a song charted by one
        // person becomes playable by the room.
        broadcast(room, S2C.SONG, { chart: room.chart, pickedBy: room.pickedBy });
        broadcast(room, S2C.CHAT, {
          system: true,
          text: `${picker?.name ?? 'someone'} picked ${chart?.song?.title ?? 'a song'}`,
        });
        publishRoom(room);
        break;
      }

      case C2S.READY: {
        if (!socket.roomId) break;
        const room = rooms.get(socket.roomId);
        if (room.round.state === 'countdown' || room.round.state === 'playing') break;
        room.setReady(socket.playerId, message.ready !== false);
        publishRoom(room);
        if (room.everyoneReady()) startCountdown(room);
        break;
      }

      case C2S.TROUBLE: {
        if (!socket.roomId) break;
        const room = rooms.get(socket.roomId);
        const player = room.players.get(socket.playerId);
        const reason = TROUBLE_REASONS[message.reason] ?? TROUBLE_REASONS.unknown;
        broadcast(room, S2C.CHAT, {
          system: true,
          text: `${player?.name ?? 'Someone'} could not play the song — ${reason}`,
        });
        // Treated as finished: they are not going to send a score, and the
        // rest of the room should not wait out the watchdog because of it.
        if (room.round.state === 'playing' && room.markFinished(socket.playerId)) {
          clearRoundTimer(room.id);
          const awarded = room.endRound();
          broadcast(room, S2C.ROUND, { round: room.round, awarded });
        }
        publishRoom(room);
        break;
      }

      case C2S.FINISH: {
        if (!socket.roomId) break;
        const room = rooms.get(socket.roomId);
        const everyone = room.markFinished(socket.playerId);
        if (everyone) {
          clearRoundTimer(room.id);
          const awarded = room.endRound();
          broadcast(room, S2C.ROUND, { round: room.round, awarded });
        }
        publishRoom(room);
        break;
      }

      case C2S.QUEUE_SONG: {
        if (!socket.roomId) break;
        const room = rooms.get(socket.roomId);
        const player = room.players.get(socket.playerId);
        const added = room.queueSong({
          id: String(message.songId ?? ''),
          title: cleanName(message.title),
          by: player?.name ?? 'someone',
        });
        if (!added) send(socket, S2C.ERROR, { error: 'The playlist is full.' });
        publishRoom(room);
        break;
      }

      default:
        send(socket, S2C.ERROR, { error: `Unknown message "${message.type}".` });
    }
  });

  socket.on('close', () => {
    if (!socket.roomId) return;
    const room = rooms.get(socket.roomId);
    const player = room.players.get(socket.playerId);
    room.removePlayer(socket.playerId);
    if (player) broadcast(room, S2C.CHAT, { system: true, text: `${player.name} left` });

    if (room.isEmpty()) {
      cancelCountdown(room.id);
      clearRoundTimer(room.id);
    }
    // The last player still in a round finishes it, rather than leaving the
    // room stuck mid-song because whoever else was playing closed their tab.
    else if (room.round.state === 'playing' && room.markFinished(player?.id ?? '')) {
      clearRoundTimer(room.id);
      broadcast(room, S2C.ROUND, { round: room.endRound() });
    }

    publishRoom(room);
    rooms.prune();
  });
});

/** The address to hand to someone else on the network. */
function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, HOST, () => {
  const local = HOST === '127.0.0.1' || HOST === 'localhost';
  console.log('neko dancer');
  console.log(`  you        http://localhost:${PORT}`);
  if (local) {
    console.log('  everyone   not reachable — bound to this machine only');
  } else {
    console.log(`  everyone   http://${lanAddress()}:${PORT}   <- share this`);
    console.log('');
    console.log('  Anyone who can reach this machine can reach this server.');
    console.log('  On a shared or public network, restrict it:');
    console.log(`    HOST=127.0.0.1 npm run serve`);
  }
});
