/**
 * Room state, with no networking in it.
 *
 * Separated from the socket layer for the same reason hop//beat's engine was
 * separated from MediaPipe: this is where the rules live, and rules are worth
 * being able to test without opening a connection.
 */
import {
  COUNTDOWN_MS,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYLIST,
  MIN_PLAYERS_FOR_REWARD,
  MAX_TITLE_LENGTH,
} from './protocol.mjs';

/**
 * Strip control characters and clamp length.
 *
 * Names and chat arrive from other people, so they are treated as hostile:
 * control characters can corrupt a terminal or a log, and an unbounded string
 * is an easy way to spoil a room for everyone in it.
 */
/**
 * Characters that have no business in a display string.
 *
 * The C0 range and DEL are the obvious ones — they corrupt terminals and logs,
 * which is why this started here. The rest are just as hostile and all sit
 * above 0x20, so a naive "is it a control character" test misses every one:
 *
 * - **C1 (0x80–0x9f)**, including NEL, which terminals still act on.
 * - **Bidi overrides and isolates.** A single U+202E reverses the rendering of
 *   everything after it, so a title can make the rest of a chat line read as
 *   something its author never wrote.
 * - **Zero-width characters.** Invisible, which means two titles that look
 *   identical are different strings — and a length cap can be filled with
 *   padding nobody can see.
 */
const isHostileChar = (code) =>
  code < 0x20 ||
  code === 0x7f ||
  (code >= 0x80 && code <= 0x9f) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

const sanitise = (value, limit) =>
  [...String(value ?? '')]
    .filter((ch) => !isHostileChar(ch.codePointAt(0)))
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

/**
 * A song title from a chart someone else wrote.
 *
 * Chart metadata was never sanitised, and the title reaches two places that
 * make that expensive: a `system: true` chat line, and the room summary that
 * goes out ten times a second. The first is the same spoof the TROUBLE message
 * was deliberately hardened against — a client that can write system text can
 * post official-looking announcements — and it was wide open through the title
 * the whole time.
 */
export function cleanTitle(title) {
  const cleaned = sanitise(title, MAX_TITLE_LENGTH);
  return cleaned.length > 0 ? cleaned : 'a song';
}

export class Room {
  constructor(id) {
    this.id = id;
    /** playerId -> player */
    this.players = new Map();
    this.playlist = [];
    this.round = { state: 'lobby', songId: null, startedAt: null };
    /**
     * The chart everyone plays this round.
     *
     * Held by the room and sent to every player, so a song charted by one
     * person is instantly playable by everyone — which is the whole reason
     * charts are small JSON rather than anything heavier.
     */
    this.chart = null;
    this.pickedBy = null;
  }

  addPlayer(id, name) {
    const player = {
      id,
      name: cleanName(name),
      score: 0,
      combo: 0,
      health: 100,
      ready: false,
      finished: false,
      sushi: 0,
      /** 'unknown' until their browser has actually tried the current song. */
      canPlay: 'unknown',
      cannotPlayReason: null,
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
        ready: p.ready,
        finished: p.finished,
        sushi: p.sushi,
        // Built field by field, never spread. A player object may gain private
        // state later, and a spread here would broadcast it to the room ten
        // times a second.
        canPlay: p.canPlay ?? 'unknown',
        cannotPlayReason: p.cannotPlayReason ?? null,
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

  /**
   * Set what the room will play.
   *
   * Un-readies everyone, because agreeing to play one thing is not agreeing to
   * play whatever it was changed to. That is only safe because picking is a
   * deliberate action of its own — when it was bundled into the ready button,
   * every player who readied wiped out everyone before them and the room could
   * never reach agreement at all.
   */
  setChart(chart, pickedBy = null) {
    this.chart = chart ?? null;
    this.pickedBy = pickedBy;
    for (const player of this.players.values()) {
      player.ready = false;
      // Whether the last song played for you says nothing about this one.
      player.canPlay = 'unknown';
      player.cannotPlayReason = null;
    }
  }

  /** Record whether a player's browser can actually play the current song. */
  setCanPlay(id, ok, reason) {
    const player = this.players.get(id);
    if (!player) return;
    player.canPlay = ok ? 'yes' : 'no';
    player.cannotPlayReason = ok ? null : reason;
    // Someone who cannot play is not going to press ready, and must not be
    // left holding a ready flag from before the song changed.
    if (!ok) player.ready = false;
  }

  rename(id, name) {
    const player = this.players.get(id);
    if (!player) return null;
    const previous = player.name;
    player.name = cleanName(name);
    return player.name === previous ? null : { from: previous, to: player.name };
  }

  setReady(id, ready) {
    const player = this.players.get(id);
    if (player) player.ready = Boolean(ready);
  }

  /**
   * Everyone who CAN play has said yes, and there is something to play.
   *
   * Players whose browser has told us the video will not load are skipped
   * rather than waited for. Otherwise one person with a restricted video holds
   * the whole room hostage: they cannot ready, so the countdown never fires,
   * and nobody else can play either.
   *
   * Requires at least one able player, so an empty room — or a room where the
   * video works for nobody — cannot start a round with itself, which `every`
   * on an empty collection would otherwise happily allow.
   */
  everyoneReady() {
    if (!this.chart) return false;
    const able = [...this.players.values()].filter((p) => p.canPlay !== 'no');
    if (able.length === 0) return false;
    return able.every((p) => p.ready);
  }

  /** Who is in the round: everyone the song actually works for. */
  playersWhoCanPlay() {
    return [...this.players.values()].filter((p) => p.canPlay !== 'no');
  }

  /**
   * Begin the countdown.
   *
   * Clients are told how long they have rather than when to start in absolute
   * terms. Machines do not agree on the time and would need synchronising
   * before an absolute instant meant anything, whereas a duration is the same
   * everywhere — and on a local network the difference in when each client
   * receives it is a millisecond or two.
   */
  beginCountdown(countdownMs = COUNTDOWN_MS) {
    this.round = {
      state: 'countdown',
      songId: this.chart?.song?.id ?? null,
      startedAt: null,
      countdownMs,
    };
    for (const player of this.players.values()) {
      player.score = 0;
      player.combo = 0;
      player.health = 100;
      player.finished = false;
    }
    return this.round;
  }

  beginPlaying() {
    this.round = { ...this.round, state: 'playing', startedAt: Date.now() };
    return this.round;
  }

  /**
   * How long the chosen song runs, by its last arrow.
   *
   * Used to bound a round rather than to time one — the clients own playback.
   */
  chartDurationMs() {
    const arrows = this.chart?.arrows;
    if (!Array.isArray(arrows) || arrows.length === 0) return 0;
    const last = arrows[arrows.length - 1]?.timeMs;
    return Number.isFinite(last) ? last : 0;
  }

  markFinished(id) {
    const player = this.players.get(id);
    if (player) player.finished = true;
    return [...this.players.values()].every((p) => p.finished);
  }

  endRound() {
    this.round = { ...this.round, state: 'results' };
    for (const player of this.players.values()) player.ready = false;
    return this.awardSushi();
  }

  toJSON() {
    return {
      id: this.id,
      players: this.scoreboard(),
      playlist: this.playlist,
      round: this.round,
      songChooser: this.songChooser(),
      // A summary only. The chart itself travels in its own message, because
      // this object is broadcast many times a second during a round.
      // Read defensively even though PICK_SONG now checks the same fields.
      // This object is built on every broadcast, ten times a second, and it
      // once took the server down by reaching through a `song` that was not
      // there. Two independent guards, because one of them was enough to be
      // wrong.
      song: this.chart?.song
        ? {
            id: String(this.chart.song.id ?? ''),
            title: cleanTitle(this.chart.song.title),
            arrows: Array.isArray(this.chart.arrows) ? this.chart.arrows.length : 0,
            pickedBy: this.pickedBy,
          }
        : null,
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
