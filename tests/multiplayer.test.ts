/**
 * Two clients, one server, over a real socket.
 *
 * Everything else in this suite calls `Room` directly, and that is why the bug
 * this file exists for survived: the room logic was correct in isolation and
 * the game was still unplayable, because the CLIENT sent the wrong messages in
 * the wrong order. The only way to catch that is to speak the protocol.
 *
 * Reported as: "The other user is not able to get the song when both hit
 * 'ready'. The other user does not see the song i set available."
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const PORT = 5399;
const URL = `ws://127.0.0.1:${PORT}`;

/** A chart big enough to be realistic — the 4 KB cap once choked on one. */
const CHART = {
  schemaVersion: 1,
  song: {
    id: 'youtube:abc123',
    title: "Vero's pick",
    playback: { provider: 'youtube', videoId: 'abc123' },
  },
  analysis: { bpm: 174, offsetMs: 0 },
  source: 'generated',
  arrows: Array.from({ length: 300 }, (_, i) => ({
    id: `a${i}`,
    timeMs: i * 345,
    lane: (['left', 'down', 'up', 'right'] as const)[i % 4],
    type: 'tap',
  })),
};

let server: ChildProcess;

beforeAll(async () => {
  server = spawn('node', ['server/index.mjs'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait for the banner rather than a fixed sleep: a timer that is long enough
  // on this machine is a flake on a slower one.
  await new Promise<void>((resolve, reject) => {
    const done = setTimeout(() => reject(new Error('server did not start')), 10_000);
    server.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('http://')) {
        clearTimeout(done);
        resolve();
      }
    });
  });
});

afterAll(() => server?.kill());

interface Client {
  socket: WebSocket;
  received: Array<Record<string, any>>;
  send: (type: string, payload?: Record<string, unknown>) => void;
  /** Resolve once a message of this type has arrived, or throw on timeout. */
  waitFor: (type: string, predicate?: (m: any) => boolean) => Promise<any>;
  close: () => void;
}

async function connect(name: string, room = 'testroom'): Promise<Client> {
  const socket = new WebSocket(URL);
  const received: Array<Record<string, any>> = [];
  const listeners: Array<(m: any) => void> = [];

  socket.on('message', (data) => {
    const message = JSON.parse(String(data));
    received.push(message);
    for (const listener of [...listeners]) listener(message);
  });

  await once(socket, 'open');

  const client: Client = {
    socket,
    received,
    send: (type, payload = {}) => socket.send(JSON.stringify({ type, ...payload })),
    waitFor: (type, predicate) =>
      new Promise((resolve, reject) => {
        const hit = received.find((m) => m.type === type && (!predicate || predicate(m)));
        if (hit) return resolve(hit);
        const timer = setTimeout(
          () => reject(new Error(`${name} never received "${type}"`)),
          5000,
        );
        const listener = (m: any) => {
          if (m.type !== type || (predicate && !predicate(m))) return;
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(listener), 1);
          resolve(m);
        };
        listeners.push(listener);
      }),
    close: () => socket.close(),
  };

  client.send('join', { name, roomId: room });
  await client.waitFor('welcome');
  return client;
}

describe('two players in a room', () => {
  it('shares the chart with everyone the moment it is picked', async () => {
    const vero = await connect('Vero', 'share');
    const friend = await connect('Friend', 'share');

    vero.send('pickSong', { chart: CHART });

    // The whole chart, not a summary: the other player has never charted this
    // song and cannot play a title and an arrow count.
    const seen = await friend.waitFor('song');
    expect(seen.chart.song.title).toBe("Vero's pick");
    expect(seen.chart.arrows).toHaveLength(300);
    expect(seen.pickedBy).toBe('Vero');

    vero.close();
    friend.close();
  });

  it('gives a late joiner the song already chosen', async () => {
    const vero = await connect('Vero', 'late');
    vero.send('pickSong', { chart: CHART });
    await vero.waitFor('song');

    const latecomer = await connect('Latecomer', 'late');
    const seen = await latecomer.waitFor('song');
    expect(seen.chart.arrows).toHaveLength(300);

    vero.close();
    latecomer.close();
  });

  /**
   * The regression. Picking un-readies the room — correctly, since agreeing to
   * play one song is not agreeing to play another. But the ready button used
   * to send the pick too, so the second player to ready silently un-readied
   * the first, and `everyoneReady()` was never true. The countdown could not
   * fire no matter how many times either of them pressed it.
   */
  it('counts down once both are ready, and stays ready in between', async () => {
    const vero = await connect('Vero', 'countdown');
    const friend = await connect('Friend', 'countdown');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');

    vero.send('ready', { ready: true });
    friend.send('ready', { ready: true });

    const round = await friend.waitFor('round', (m) => m.round.state === 'countdown');
    expect(round.round.countdownMs).toBeGreaterThan(0);
    // The chart rides along with the go-ahead as well, so a client that
    // somehow missed the pick still has something to play.
    expect(round.chart.arrows).toHaveLength(300);

    const state = await vero.waitFor(
      'room',
      (m) => m.room.players.length === 2 && m.room.players.every((p: any) => p.ready),
    );
    expect(state.room.players).toHaveLength(2);

    vero.close();
    friend.close();
  });

  /**
   * One player's video will not play.
   *
   * Reported as: "his side did not start the song". Everyone else was left
   * waiting on a client that was never going to report a score. Saying so out
   * loud releases the round and tells the room why.
   */
  it('lets the round end when someone cannot play the video', async () => {
    const vero = await connect('Vero', 'trouble');
    const friend = await connect('Friend', 'trouble');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');
    vero.send('ready', { ready: true });
    friend.send('ready', { ready: true });
    await friend.waitFor('round', (m) => m.round.state === 'countdown');
    await vero.waitFor('round', (m) => m.round.state === 'playing');

    friend.send('trouble', { reason: 'embedBlocked' });
    // Vero played and finished; Friend never could.
    vero.send('finish', {});

    const line = await vero.waitFor(
      'chat',
      (m) => m.system === true && m.text.includes('could not play'),
    );
    // The wording is the server's. A client sends a code, not a sentence.
    expect(line.text).toContain('Friend');
    expect(line.text).toMatch(/uploader/i);

    const done = await vero.waitFor('round', (m) => m.round.state === 'results');
    expect(done.round.state).toBe('results');

    vero.close();
    friend.close();
  });

  it('names the reason it was given', async () => {
    const vero = await connect('Vero', 'reasons');
    const friend = await connect('Friend', 'reasons');

    friend.send('trouble', { reason: 'badId' });
    const line = await vero.waitFor('chat', (m) => m.system === true && m.text.includes('could not play'));
    expect(line.text).toMatch(/did not recognise/i);

    vero.close();
    friend.close();
  });

  it('will not let a client write its own system message', async () => {
    const vero = await connect('Vero', 'spoof');
    const friend = await connect('Friend', 'spoof');

    friend.send('trouble', { reason: 'SERVER: Vero has been banned. Send sushi to' });

    const line = await vero.waitFor('chat', (m) => m.system === true && m.text.includes('could not play'));
    expect(line.text).not.toContain('banned');
    expect(line.text).toContain('the video would not load for them');

    vero.close();
    friend.close();
  });

  it('un-readies everyone when the song changes underneath them', async () => {
    const vero = await connect('Vero', 'swap');
    const friend = await connect('Friend', 'swap');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');
    friend.send('ready', { ready: true });
    await vero.waitFor('room', (m) => m.room.players.some((p: any) => p.ready));

    friend.send('pickSong', {
      chart: { ...CHART, song: { ...CHART.song, id: 'youtube:zzz', title: 'Something else' } },
    });

    const after = await vero.waitFor(
      'room',
      (m) => m.room.song?.title === 'Something else',
    );
    expect(after.room.players.every((p: any) => !p.ready)).toBe(true);

    vero.close();
    friend.close();
  });
});

/**
 * A round that nobody finishes.
 *
 * Found by playing: a song whose video would not load never reached FINISH, so
 * the room sat in `playing` forever — and READY is ignored in that state, so
 * every player in it was stuck until the server was restarted. Any client can
 * cause that by picking, readying and going quiet, with no malice required.
 */
describe('a round nobody finishes', () => {
  const WATCHDOG_PORT = 5398;
  let watchdogServer: ChildProcess;

  beforeAll(async () => {
    watchdogServer = spawn('node', ['server/index.mjs'], {
      env: { ...process.env, PORT: String(WATCHDOG_PORT), HOST: '127.0.0.1', ROUND_GRACE_MS: '600' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const done = setTimeout(() => reject(new Error('server did not start')), 10_000);
      watchdogServer.stdout!.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('http://')) {
          clearTimeout(done);
          resolve();
        }
      });
    });
  });

  afterAll(() => watchdogServer?.kill());

  it('ends itself rather than locking the room', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${WATCHDOG_PORT}`);
    const received: any[] = [];
    socket.on('message', (d) => received.push(JSON.parse(String(d))));
    await once(socket, 'open');

    const send = (type: string, payload: Record<string, unknown> = {}) =>
      socket.send(JSON.stringify({ type, ...payload }));

    send('join', { name: 'Vero', roomId: 'stuck' });
    // A short chart, so the watchdog is the grace period and not the song.
    send('pickSong', { chart: { ...CHART, arrows: CHART.arrows.slice(0, 2) } });
    send('ready', { ready: true });

    // Countdown (3s) + grace (0.6s), then the round must let go on its own.
    // Deliberately never sends FINISH.
    await new Promise((r) => setTimeout(r, 5200));

    const states = received.filter((m) => m.type === 'round').map((m) => m.round.state);
    expect(states).toContain('playing');
    expect(states).toContain('results');

    socket.close();
  }, 15_000);
});

/**
 * Messages that used to kill the server.
 *
 * Every entry here is a real crash, found by attacking a running server rather
 * than by reading the code. The pattern they share is worth more than any one
 * of them: `ws` dispatches the message listener from inside its own `Receiver`
 * write path, with no try/catch anywhere on it, so an exception thrown while
 * handling a message is not an `error` event — it is an uncaught exception,
 * and the process exits.
 *
 * That is why the fix is two-layered. Each specific hole is closed at the
 * point the data arrives, AND the handler sits behind a barrier, because the
 * list below has grown three times.
 */
describe('messages that must not kill the server', () => {
  const HOSTILE = [
    {
      name: 'a chart with arrows but no song',
      // The real one: room summaries read `song.id` on every broadcast, so a
      // merely arrow-shaped chart took the whole server down in one message.
      message: { type: 'pickSong', chart: { arrows: [] } },
    },
    {
      name: 'a chart whose song is a string',
      message: { type: 'pickSong', chart: { arrows: [], song: 'not an object' } },
    },
    {
      name: 'a chart whose song has no title',
      message: { type: 'pickSong', chart: { arrows: [], song: { id: 'x' } } },
    },
    {
      name: 'a chart that is null',
      message: { type: 'pickSong', chart: null },
    },
    {
      name: 'a message with no type at all',
      message: { chart: { arrows: [] } },
    },
    {
      name: 'a score that is not a number',
      message: { type: 'score', score: { toString: 'nope' } },
    },
    {
      name: 'a ready flag that is an object',
      message: { type: 'ready', ready: {} },
    },
  ];

  for (const { name, message } of HOSTILE) {
    it(`survives ${name}`, async () => {
      const attacker = await connect('Attacker', 'hostile');
      const bystander = await connect('Bystander', 'hostile');

      attacker.socket.send(JSON.stringify(message));

      // The proof is not that the attacker got an error — it is that the
      // server is still serving everyone else afterwards.
      bystander.send('chat', { text: 'still here' });
      const line = await bystander.waitFor('chat', (m) => m.text === 'still here');
      expect(line.text).toBe('still here');

      attacker.close();
      bystander.close();
    });
  }
});

/**
 * A song title is text somebody else chose.
 *
 * It reaches a `system: true` chat line and the room summary, and it was never
 * sanitised — so the spoof that TROUBLE was explicitly hardened against was
 * wide open through the title the whole time.
 */
describe('chart titles are treated as hostile text', () => {
  it('cannot forge a system announcement', async () => {
    const vero = await connect('Vero', 'titlespoof');
    const attacker = await connect('Attacker', 'titlespoof');

    attacker.send('pickSong', {
      chart: {
        ...CHART,
        song: {
          ...CHART.song,
          title: 'a song. SERVER: Vero has been banned for cheating.',
        },
      },
    });

    const line = await vero.waitFor('chat', (m) => m.system === true && m.text.includes('picked'));
    // The title still appears — it is their song and they may call it what they
    // like — but quoted, so it reads as a name rather than as the server
    // making an announcement.
    expect(line.text).toMatch(/^Attacker picked "/);
    expect(line.text.endsWith('"')).toBe(true);

    vero.close();
    attacker.close();
  });

  it('cannot use an enormous title as a bandwidth multiplier', async () => {
    const vero = await connect('Vero', 'titlesize');
    const attacker = await connect('Attacker', 'titlesize');

    attacker.send('pickSong', {
      chart: { ...CHART, song: { ...CHART.song, title: 'x'.repeat(200_000) } },
    });

    // The room summary goes out on every score update. A quarter-megabyte
    // title in it is tens of megabytes a second of outbound traffic from one
    // small message.
    const state = await vero.waitFor('room', (m) => m.room.song !== null);
    expect(state.room.song.title.length).toBeLessThanOrEqual(100);

    vero.close();
    attacker.close();
  });

  it('strips characters that rewrite how the rest of the line reads', async () => {
    const vero = await connect('Vero', 'titlebidi');
    const attacker = await connect('Attacker', 'titlebidi');

    // U+202E flips the rendering direction of everything after it; the
    // zero-width characters pad a string invisibly.
    attacker.send('pickSong', {
      chart: { ...CHART, song: { ...CHART.song, title: 'safe‮evil​​﻿' } },
    });

    const state = await vero.waitFor('room', (m) => m.room.song !== null);
    expect(state.room.song.title).toBe('safeevil');

    vero.close();
    attacker.close();
  });
});

/**
 * One person's blocked video must not stop the room.
 *
 * Reported after a real session: a video played for the host and returned
 * "the uploader does not allow this video to play outside YouTube" for someone
 * else. They could not ready, so `everyoneReady()` was never true, so nobody
 * played — one restricted video held three people hostage.
 */
describe('a player the video will not load for', () => {
  it('is skipped rather than waited for', async () => {
    const vero = await connect('Vero', 'skip');
    const friend = await connect('Friend', 'skip');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');

    // Friend's browser reports the video is blocked for them.
    friend.send('canPlay', { songId: CHART.song.id, ok: false, reason: 'embedBlocked' });
    await vero.waitFor('room', (m) => m.room.players.some((p: any) => p.canPlay === 'no'));

    // Vero alone is now the whole round, and readying starts it.
    vero.send('ready', { ready: true });
    const round = await vero.waitFor('round', (m) => m.round.state === 'countdown');
    expect(round.round.countdownMs).toBeGreaterThan(0);

    vero.close();
    friend.close();
  });

  it('is announced, so nobody has to guess who is missing', async () => {
    const vero = await connect('Vero', 'announce');
    const friend = await connect('Friend', 'announce');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');
    friend.send('canPlay', { songId: CHART.song.id, ok: false, reason: 'embedBlocked' });

    const line = await vero.waitFor('chat', (m) => m.system === true && m.text.includes('cannot play'));
    expect(line.text).toContain('Friend');
    expect(line.text).toMatch(/uploader/i);

    vero.close();
    friend.close();
  });

  it('starts the round the moment the last able player is ready', async () => {
    const vero = await connect('Vero', 'lastable');
    const friend = await connect('Friend', 'lastable');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');
    vero.send('ready', { ready: true });

    // Vero is already ready; Friend dropping out is what completes the room.
    friend.send('canPlay', { songId: CHART.song.id, ok: false, reason: 'embedBlocked' });

    const round = await vero.waitFor('round', (m) => m.round.state === 'countdown');
    expect(round.round.state).toBe('countdown');

    vero.close();
    friend.close();
  });

  /** A room where the song works for nobody must not start a round with itself. */
  it('does not start a round nobody can play', async () => {
    const vero = await connect('Vero', 'nobody');
    vero.send('pickSong', { chart: CHART });
    await vero.waitFor('song');
    vero.send('canPlay', { songId: CHART.song.id, ok: false, reason: 'embedBlocked' });
    vero.send('ready', { ready: true });

    await new Promise((r) => setTimeout(r, 600));
    const rounds = vero.received.filter((m) => m.type === 'round');
    expect(rounds).toHaveLength(0);

    vero.close();
  });

  /** A late answer about the previous song must not disqualify anyone. */
  it('ignores an answer about a song the room has moved on from', async () => {
    const vero = await connect('Vero', 'stale');
    const friend = await connect('Friend', 'stale');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');
    friend.send('canPlay', { songId: 'youtube:some-old-song', ok: false, reason: 'embedBlocked' });

    await new Promise((r) => setTimeout(r, 400));
    const latest = [...vero.received].reverse().find((m) => m.type === 'room');
    expect(latest).toBeDefined();
    expect(latest!.room.players.every((p: any) => p.canPlay !== 'no')).toBe(true);

    vero.close();
    friend.close();
  });
});

/**
 * Two windows both called "neko" cannot be told apart, and the name was only
 * ever sent at JOIN — so editing it after connecting changed nothing anyone
 * else saw.
 */
describe('renaming', () => {
  it('changes the name everyone else sees', async () => {
    const vero = await connect('Vero', 'rename');
    const friend = await connect('Friend', 'rename');

    friend.send('rename', { name: 'meowm' });

    const state = await vero.waitFor('room', (m) =>
      m.room.players.some((p: any) => p.name === 'meowm'),
    );
    expect(state.room.players.map((p: any) => p.name)).toContain('meowm');

    vero.close();
    friend.close();
  });

  it('sanitises a new name like any other', async () => {
    const vero = await connect('Vero', 'renameclean');
    const attacker = await connect('Attacker', 'renameclean');

    attacker.send('rename', { name: 'x'.repeat(200) });

    const state = await vero.waitFor('room', (m) =>
      m.room.players.some((p: any) => p.name.startsWith('x')),
    );
    const renamed = state.room.players.find((p: any) => p.name.startsWith('x'));
    expect(renamed.name.length).toBeLessThanOrEqual(20);

    vero.close();
    attacker.close();
  });
});

/**
 * A room that outlives one song.
 *
 * Until P0 there was no way back: the round reached `results` and each player
 * saw a private card with a "Play again" button that started a SOLO run. So a
 * session was pick, ready, play once, and then everybody sat there. This is the
 * cycle the "Back to the room" button makes reachable, and it is worth pinning
 * because a second round exercises reset paths the first one never touches.
 */
describe('a second round', () => {
  it('can be played without anyone rejoining', async () => {
    const vero = await connect('Vero', 'tworounds');
    const friend = await connect('Friend', 'tworounds');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');

    // --- round one ---
    vero.send('ready', { ready: true });
    friend.send('ready', { ready: true });
    await vero.waitFor('round', (m) => m.round.state === 'countdown');
    await vero.waitFor('round', (m) => m.round.state === 'playing');

    vero.send('score', { score: 5000, combo: 20, health: 90 });
    vero.send('finish', {});
    friend.send('finish', {});
    await vero.waitFor('round', (m) => m.round.state === 'results');

    // Everyone is un-readied by the end of a round, so the next one starts the
    // same way the last one did rather than beginning instantly.
    //
    // Waiting on `finished`, not on `!ready`. `waitFor` scans the whole history
    // for the first match, and nobody was ready at the START of the session
    // either — so a `!ready` predicate matches a broadcast from before the
    // round even began, and asserts nothing about the end of it.
    const afterRound = await vero.waitFor('room', (m) =>
      m.room.players.every((p: any) => p.finished),
    );
    expect(afterRound.room.players.every((p: any) => !p.ready)).toBe(true);

    // --- round two, same players, same socket ---
    vero.send('ready', { ready: true });
    friend.send('ready', { ready: true });
    const second = await vero.waitFor(
      'round',
      (m) => m.round.state === 'countdown' && m.round.startedAt === null,
    );
    expect(second.round.state).toBe('countdown');

    // Last round's numbers must not be sitting on the board.
    const fresh = await vero.waitFor('room', (m) =>
      m.room.players.every((p: any) => p.score === 0 && !p.finished),
    );
    expect(fresh.room.players.every((p: any) => p.health === 100)).toBe(true);

    vero.close();
    friend.close();
  });

  /** A player who sits out one round must be able to play the next one. */
  it('lets someone who could not play the last song play the next', async () => {
    const vero = await connect('Vero', 'sitout');
    const friend = await connect('Friend', 'sitout');

    vero.send('pickSong', { chart: CHART });
    await friend.waitFor('song');
    friend.send('canPlay', { songId: CHART.song.id, ok: false, reason: 'embedBlocked' });
    await vero.waitFor('room', (m) => m.room.players.some((p: any) => p.canPlay === 'no'));

    // A different song: picking must clear everyone's verdict about the old one.
    vero.send('pickSong', {
      chart: { ...CHART, song: { ...CHART.song, id: 'youtube:second', title: 'Another' } },
    });

    const cleared = await vero.waitFor('room', (m) => m.room.song?.title === 'Another');
    expect(cleared.room.players.every((p: any) => p.canPlay !== 'no')).toBe(true);

    vero.close();
    friend.close();
  });
});
