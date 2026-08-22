import { describe, expect, it } from 'vitest';
// @ts-expect-error — the server is plain JS on purpose; it runs under node, not vite.
import { Room, RoomRegistry, cleanChat, cleanName } from '../server/rooms.mjs';

const chart = { song: { id: 's', title: 'Song' }, arrows: [{ id: 'a', timeMs: 0 }] };

describe('room readiness', () => {
  /**
   * `every` on an empty collection is true, which would let a room with nobody
   * in it start a round with itself.
   */
  it('an empty room is never ready', () => {
    const room = new Room('lobby');
    room.setChart(chart);
    expect(room.everyoneReady()).toBe(false);
  });

  it('is not ready without a song, however many people said yes', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.setReady('a', true);
    expect(room.everyoneReady()).toBe(false);
  });

  it('waits for everyone, not just the first', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.addPlayer('b', 'Friend');
    room.setChart(chart);

    room.setReady('a', true);
    expect(room.everyoneReady()).toBe(false);

    room.setReady('b', true);
    expect(room.everyoneReady()).toBe(true);
  });

  /** Agreeing to play one song is not agreeing to play whatever it became. */
  it('un-readies everyone when the song changes', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.setChart(chart);
    room.setReady('a', true);

    room.setChart({ ...chart, song: { id: 'other', title: 'Something else' } });
    expect(room.everyoneReady()).toBe(false);
  });

  it('clears ready after a round, so the next one is agreed again', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.setChart(chart);
    room.setReady('a', true);
    room.beginCountdown();
    room.beginPlaying();
    room.markFinished('a');
    room.endRound();
    expect(room.everyoneReady()).toBe(false);
  });
});

describe('the round', () => {
  it('resets every player when the countdown begins', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.setChart(chart);
    room.updateScore('a', { score: 900, combo: 30, health: 20 });

    room.beginCountdown();
    const [player] = room.scoreboard();
    expect(player.score).toBe(0);
    expect(player.health).toBe(100);
    expect(player.finished).toBe(false);
  });

  it('tells clients how long they have, not when to start', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.setChart(chart);
    // A duration means the same on every machine; an instant would need the
    // clocks synchronised first.
    expect(room.beginCountdown(3000).countdownMs).toBe(3000);
    expect(room.beginCountdown(3000).startedAt).toBeNull();
  });

  it('ends only when the last player has finished', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.addPlayer('b', 'Friend');
    expect(room.markFinished('a')).toBe(false);
    expect(room.markFinished('b')).toBe(true);
  });
});

describe('ranking and rewards', () => {
  it('ranks by score, computed here rather than trusted from a client', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.addPlayer('b', 'Friend');
    room.updateScore('a', { score: 500 });
    room.updateScore('b', { score: 2400 });
    expect(room.scoreboard().map((p) => p.name)).toEqual(['Friend', 'Vero']);
    expect(room.songChooser()).toBe('b');
  });

  it('clamps a claimed score into a sane range', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.updateScore('a', { score: -50, health: 500 });
    const [player] = room.scoreboard();
    expect(player.score).toBe(0);
    expect(player.health).toBe(100);
  });

  /** Sushi is earned with company, as in the original. Solo pays nothing. */
  it('pays nobody for playing alone', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.markFinished('a');
    expect(room.endRound()).toEqual([]);
  });

  it('pays everyone who finished when there were others there', () => {
    const room = new Room('lobby');
    room.addPlayer('a', 'Vero');
    room.addPlayer('b', 'Friend');
    room.markFinished('a');
    room.markFinished('b');
    expect(room.endRound()).toHaveLength(2);
  });
});

describe('untrusted text', () => {
  it('strips control characters that would corrupt a log or a terminal', () => {
    expect(cleanChat('hi\u0007the\u0000re')).toBe('hithere');
    expect(cleanName('Ve\u001bro')).toBe('Vero');
  });

  it('clamps length so one person cannot flood a room', () => {
    expect(cleanName('x'.repeat(500)).length).toBeLessThanOrEqual(20);
    expect(cleanChat('y'.repeat(5000)).length).toBeLessThanOrEqual(200);
  });

  it('falls back to a name rather than an empty one', () => {
    expect(cleanName('   ')).toBe('neko');
    expect(cleanName(undefined)).toBe('neko');
  });
});

describe('the registry', () => {
  it('closes a room when the last player leaves', () => {
    const rooms = new RoomRegistry();
    const room = rooms.get('lobby');
    room.addPlayer('a', 'Vero');
    room.removePlayer('a');
    rooms.prune();
    expect(rooms.size()).toBe(0);
  });

  it('gives everyone asking for the same name the same room', () => {
    const rooms = new RoomRegistry();
    expect(rooms.get('friday')).toBe(rooms.get('friday'));
  });
});
