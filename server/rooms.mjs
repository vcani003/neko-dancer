/**
 * Room state, with no networking in it.
 *
 * Separated from the socket layer for the same reason hop//beat's engine was
 * separated from MediaPipe: this is where the rules live, and rules are worth
 * being able to test without opening a connection.
 */
import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, MAX_PLAYLIST, MIN_PLAYERS_FOR_REWARD } from './protocol.mjs';

/**
 * Strip control characters and clamp length.
 *
 * Names and chat arrive from other people, so they are treated as hostile:
 * control characters can corrupt a terminal or a log, and an unbounded string
 * is an easy way to spoil a room for everyone in it.
 */
const isControlChar = (code) => code < 0x20 || code === 0x7f;

const sanitise = (value, limit) =>
  [...String(value ?? '')]
    .filter((ch) => !isControlChar(ch.codePointAt(0)))
    .join('')
    .trim()
    .slice(0, limit);

export function cleanName(name) {
  const cleaned = sanitise(name, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : 'neko';
}

export function cleanChat(text) {
  return sanitise(text, MAX_CHAT_LENGTH);
}

export class Room {
  constructor(id) {
    this.id = id;
    /** playerId -> player */
    this.players = new Map();
    this.playlist = [];
    this.round = { state: 'lobby', songId: null, startedAt: null };
  }

  addPlayer(id, name) {
    const player = {
      id,
      name: cleanName(name),
      score: 0,
      combo: 0,
      health: 100,
      finished: false,
      sushi: 0,
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  get playerCount() {
    return this.players.size;
  }

  isEmpty() {
    return this.players.size === 0;
  }

  updateScore(id, { score, combo, health }) {
    const player = this.players.get(id);
    if (!player) return;
    if (Number.isFinite(score)) player.score = Math.max(0, Math.round(score));
    if (Number.isFinite(combo)) player.combo = Math.max(0, Math.round(combo));
    if (Number.isFinite(health)) player.health = Math.min(100, Math.max(0, health));
  }

  /**
   * The live board, best first.
   *
   * Ranking is computed here rather than trusted from a client. A score arriving
   * over a socket is a claim, not a fact — this is a local game today, but the
   * shape should not have to change when it stops being one.
   */
  scoreboard() {
    return [...this.players.values()]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((p, index) => ({
        rank: index + 1,
        id: p.id,
        name: p.name,
        score: p.score,
        combo: p.combo,
        health: p.health,
        finished: p.finished,
        sushi: p.sushi,
      }));
  }

  /** Whoever is top picks the next song, as in the original. */
  songChooser() {
    return this.scoreboard()[0]?.id ?? null;
  }

  queueSong(entry) {
    if (this.playlist.length >= MAX_PLAYLIST) return false;
    this.playlist.push(entry);
    return true;
  }

  /** Sushi is only earned with company. Solo play pays nothing. */
  awardSushi() {
    if (this.playerCount < MIN_PLAYERS_FOR_REWARD) return [];
    const awarded = [];
    for (const player of this.players.values()) {
      if (!player.finished) continue;
      const amount = 1 + Math.floor(player.score / 1000);
      player.sushi += amount;
      awarded.push({ id: player.id, amount, total: player.sushi });
    }
    return awarded;
  }

  startRound(songId) {
    this.round = { state: 'playing', songId, startedAt: Date.now() };
    for (const player of this.players.values()) {
      player.score = 0;
      player.combo = 0;
      player.health = 100;
      player.finished = false;
    }
  }

  markFinished(id) {
    const player = this.players.get(id);
    if (player) player.finished = true;
    return [...this.players.values()].every((p) => p.finished);
  }

  endRound() {
    this.round = { ...this.round, state: 'results' };
    return this.awardSushi();
  }

  toJSON() {
    return {
      id: this.id,
      players: this.scoreboard(),
      playlist: this.playlist,
      round: this.round,
      songChooser: this.songChooser(),
    };
  }
}

export class RoomRegistry {
  constructor() {
    this.rooms = new Map();
  }

  get(id) {
    const roomId = sanitise(id, 24) || 'lobby';
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }
    return room;
  }

  /** Rooms are disposable: the last player out closes it. */
  prune() {
    for (const [id, room] of this.rooms) {
      if (room.isEmpty()) this.rooms.delete(id);
    }
  }

  size() {
    return this.rooms.size;
  }

  has(id) {
    return this.rooms.has(sanitise(id, 24) || 'lobby');
  }

  list() {
    return [...this.rooms.values()].map((r) => ({ id: r.id, players: r.playerCount }));
  }
}
