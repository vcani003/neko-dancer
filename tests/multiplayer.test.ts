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
