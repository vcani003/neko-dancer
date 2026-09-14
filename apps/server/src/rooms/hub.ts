/**
 * In-memory rooms for the Public and Staging loops.
 *
 * Not a database. Charts stay in the store. This only knows who is here,
 * whether a song is counting down or playing, and what to say in chat.
 * Cap 6 on Public. Staging is one dressing room.
 *
 * Public starts itself. Staging waits for Ready — it is a workshop, and
 * the YouTube pause button is part of that.
 */
import { COUNTDOWN_MS, MAX_CHAT_HISTORY, ROOM_START_BUFFER_MS } from '@neko/protocol';
import type { RevisionId, User } from '@neko/protocol';

export const PUBLIC_ROOM_ID = 'public';
export const STAGING_ROOM_ID = 'staging';
export const PUBLIC_CAP = 6;

export interface RoomPlayerView {
  id: string;
  name: string;
  ready: boolean;
}

export interface RoomListing {
  id: string;
  name: string;
  occupants: number;
  cap: number;
}

export interface RoomSend {
  (payload: unknown): void;
}

export type JoinResult =
  | { ok: false; error: string }
  | {
      ok: true;
      roomId: string;
      /** First occupant of an idle Public room — pick a chart and buffer. */
      start: boolean;
      /** Mid-countdown join: play this chart with whatever is left on the clock. */
      catchup?: { revisionId: RevisionId; countdownMs: number };
      /** Mid-song join in Public: watch only. */
      spectate?: { revisionId: RevisionId; elapsedMs: number };
    };

export type LeaveResult = {
  roomId: string | null;
  emptied: boolean;
  startNext: boolean;
};

export type FinishResult = { roomId: string; startNext: boolean } | null;

type Seat = {
  user: User;
  send: RoomSend;
  ready: boolean;
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'arming' }
  | {
      kind: 'countdown';
      revisionId: RevisionId;
      endsAt: number;
      participants: Set<string>;
    }
  | {
      kind: 'playing';
      revisionId: RevisionId;
      startedAt: number;
      participants: Set<string>;
      finished: Set<string>;
    };

type RoomLive = {
  seats: Map<string, Seat>;
  phase: Phase;
};

export class RoomHub {
  private readonly publicRoom: RoomLive = { seats: new Map(), phase: { kind: 'idle' } };
  private readonly stagingRoom: RoomLive = { seats: new Map(), phase: { kind: 'idle' } };
  private stagingRevisionId: RevisionId | null = null;
  private shuffleAt = 0;
  private readonly history = new Map<string, unknown[]>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  listing(): RoomListing[] {
    return [
      {
        id: PUBLIC_ROOM_ID,
        name: 'Public',
        occupants: this.publicRoom.seats.size,
        cap: PUBLIC_CAP,
      },
    ];
  }

  occupants(roomId: string): number {
    return this.live(roomId).seats.size;
  }

  announce(roomId: string, payload: unknown): void {
    this.broadcast(roomId, payload);
  }

  join(
    roomId: string,
    user: User,
    send: RoomSend,
    stagingRevisionId?: RevisionId,
  ): JoinResult {
    if (roomId !== PUBLIC_ROOM_ID && roomId !== STAGING_ROOM_ID) {
      return { ok: false, error: 'No such room.' };
    }
    const room = this.live(roomId);
    if (roomId === PUBLIC_ROOM_ID && room.seats.size >= PUBLIC_CAP && !room.seats.has(user.id)) {
      return { ok: false, error: 'That room is full (6).' };
    }
    if (roomId === STAGING_ROOM_ID && stagingRevisionId) {
      this.stagingRevisionId = stagingRevisionId;
    }
    const reseated = room.seats.has(user.id);
    room.seats.set(user.id, { user, send, ready: false });
    for (const line of this.history.get(roomId) ?? []) send(line);
    if (!reseated) {
      const joined = { type: 'chat', system: true, text: `${user.displayName} joined` };
      this.remember(roomId, joined);
      this.broadcast(roomId, joined);
    }
    this.broadcastRoom(roomId);

    if (roomId === STAGING_ROOM_ID) {
      return { ok: true, roomId, start: false };
    }

    const phase = this.promote(room);
    if (phase.kind === 'countdown') {
      phase.participants.add(user.id);
      return {
        ok: true,
        roomId,
        start: false,
        catchup: {
          revisionId: phase.revisionId,
          countdownMs: Math.max(0, phase.endsAt - this.now()),
        },
      };
    }
    if (phase.kind === 'playing') {
      return {
        ok: true,
        roomId,
        start: false,
        spectate: {
          revisionId: phase.revisionId,
          elapsedMs: Math.max(0, this.now() - phase.startedAt),
        },
      };
    }
    if (phase.kind === 'arming') {
      return { ok: true, roomId, start: false };
    }

    room.phase = { kind: 'arming' };
    return { ok: true, roomId, start: true };
  }

  leave(userId: string, send?: RoomSend): LeaveResult {
    for (const roomId of [PUBLIC_ROOM_ID, STAGING_ROOM_ID]) {
      const room = this.live(roomId);
      const seat = room.seats.get(userId);
      if (!seat) continue;
      // StrictMode (and a refresh) opens a second socket before the first
      // closes. The old close must not evict the seat the new socket just sat.
      if (send && seat.send !== send) {
        return { roomId, emptied: false, startNext: false };
      }
      room.seats.delete(userId);
      const left = { type: 'chat', system: true, text: `${seat.user.displayName} left` };
      this.remember(roomId, left);
      this.broadcast(roomId, left);
      this.broadcastRoom(roomId);
      if (room.seats.size === 0) {
        this.reset(roomId);
        return { roomId, emptied: true, startNext: false };
      }
      const startNext = roomId === PUBLIC_ROOM_ID && this.maybeArmNext(room);
      return { roomId, emptied: false, startNext };
    }
    return { roomId: null, emptied: false, startNext: false };
  }

  chat(userId: string, text: string): void {
    const found = this.find(userId);
    if (!found) return;
    const payload = {
      type: 'chat',
      from: found.seat.user.displayName,
      userId: found.seat.user.id,
      text,
    };
    this.remember(found.roomId, payload);
    this.broadcast(found.roomId, payload);
  }

  /**
   * Staging only. Public does not wait for Ready.
   */
  ready(userId: string, ready: boolean): { allReady: boolean; roomId: string } | null {
    const found = this.find(userId);
    if (!found || found.roomId !== STAGING_ROOM_ID) return null;
    if (found.room.phase.kind !== 'idle') {
      return { allReady: false, roomId: found.roomId };
    }
    found.seat.ready = ready;
    this.broadcastRoom(found.roomId);
    const seats = [...found.room.seats.values()];
    const allReady = seats.length > 0 && seats.every((s) => s.ready);
    if (allReady) {
      for (const seat of seats) seat.ready = false;
      found.room.phase = { kind: 'arming' };
      this.broadcastRoom(found.roomId);
    }
    return { allReady, roomId: found.roomId };
  }

  finish(userId: string): FinishResult {
    const found = this.find(userId);
    if (!found) return null;
    if (found.roomId === STAGING_ROOM_ID) {
      found.room.phase = { kind: 'idle' };
      for (const seat of found.room.seats.values()) seat.ready = false;
      this.broadcastRoom(found.roomId);
      return { roomId: found.roomId, startNext: false };
    }
    const phase = this.asPlaying(found.room);
    if (phase.kind !== 'playing') return { roomId: found.roomId, startNext: false };
    if (!phase.participants.has(userId)) return { roomId: found.roomId, startNext: false };
    phase.finished.add(userId);
    return { roomId: found.roomId, startNext: this.maybeArmNext(found.room) };
  }

  /**
   * A player who never reports finish (closed laptop) cannot hold Public.
   * Staging just goes idle — Ready starts it again.
   */
  expire(roomId: string): { startNext: boolean } {
    const room = this.live(roomId);
    if (room.phase.kind === 'idle' || room.phase.kind === 'arming') {
      return { startNext: false };
    }
    if (room.seats.size === 0) {
      this.reset(roomId);
      return { startNext: false };
    }
    if (roomId === STAGING_ROOM_ID) {
      room.phase = { kind: 'idle' };
      return { startNext: false };
    }
    room.phase = { kind: 'arming' };
    return { startNext: true };
  }

  beginCountdown(roomId: string, revisionId: RevisionId, countdownMs: number): boolean {
    const room = this.live(roomId);
    if (room.phase.kind === 'countdown' || room.phase.kind === 'playing') return false;
    room.phase = {
      kind: 'countdown',
      revisionId,
      endsAt: this.now() + countdownMs,
      participants: new Set(room.seats.keys()),
    };
    return true;
  }

  markPlaying(roomId: string): void {
    const room = this.live(roomId);
    const phase = this.promote(room);
    if (phase.kind !== 'countdown') return;
    room.phase = {
      kind: 'playing',
      revisionId: phase.revisionId,
      startedAt: this.now(),
      participants: phase.participants,
      finished: new Set(),
    };
  }

  abortArming(roomId: string): void {
    const room = this.live(roomId);
    if (room.phase.kind === 'arming') room.phase = { kind: 'idle' };
  }

  /**
   * Public only. A seated player asks for the next chart — used when
   * their run ends, so the room does not wait on a perfect finish
   * handshake or a 90 s grace timer.
   */
  advancePublic(userId: string): { roomId: string; start: boolean } | null {
    const found = this.find(userId);
    if (!found || found.roomId !== PUBLIC_ROOM_ID) return null;
    if (found.room.seats.size === 0) return { roomId: PUBLIC_ROOM_ID, start: false };
    const phase = this.promote(found.room);
    if (phase.kind === 'countdown') return { roomId: PUBLIC_ROOM_ID, start: false };
    if (phase.kind === 'playing') phase.finished.add(userId);
    found.room.phase = { kind: 'arming' };
    return { roomId: PUBLIC_ROOM_ID, start: true };
  }

  stagingRevision(): RevisionId | null {
    return this.stagingRevisionId;
  }

  nextShuffleIndex(): number {
    return this.shuffleAt++;
  }

  countdownMs(roomId: string = PUBLIC_ROOM_ID): number {
    return roomId === STAGING_ROOM_ID ? COUNTDOWN_MS : ROOM_START_BUFFER_MS;
  }

  private maybeArmNext(room: RoomLive): boolean {
    const phase = this.promote(room);
    if (phase.kind !== 'playing') return false;
    const live = [...phase.participants].filter((id) => room.seats.has(id));
    const allDone = live.length === 0 || live.every((id) => phase.finished.has(id));
    if (!allDone) return false;
    room.phase = { kind: 'arming' };
    return true;
  }

  /**
   * A countdown whose clock has run out is already a song. Finish during
   * the last ticks of the buffer still counts — otherwise a seek-to-end
   * (or a chart that dies instantly) is ignored and the room never moves.
   */
  private asPlaying(room: RoomLive): Phase {
    const phase = this.promote(room);
    if (phase.kind !== 'countdown') return phase;
    const playing: Phase = {
      kind: 'playing',
      revisionId: phase.revisionId,
      startedAt: this.now(),
      participants: phase.participants,
      finished: new Set(),
    };
    room.phase = playing;
    return playing;
  }

  /**
   * A countdown whose clock has run out is already a song, even if the
   * socket layer has not called `markPlaying` yet. Join uses that so a
   * late arrival at T+10s spectates instead of playing.
   */
  private promote(room: RoomLive): Phase {
    const phase = room.phase;
    if (phase.kind === 'countdown' && this.now() >= phase.endsAt) {
      const playing: Phase = {
        kind: 'playing',
        revisionId: phase.revisionId,
        startedAt: phase.endsAt,
        participants: phase.participants,
        finished: new Set(),
      };
      room.phase = playing;
      return playing;
    }
    return room.phase;
  }

  private reset(roomId: string): void {
    const room = this.live(roomId);
    room.phase = { kind: 'idle' };
    this.history.delete(roomId);
    if (roomId === STAGING_ROOM_ID) this.stagingRevisionId = null;
  }

  private live(roomId: string): RoomLive {
    return roomId === STAGING_ROOM_ID ? this.stagingRoom : this.publicRoom;
  }

  private find(userId: string): { roomId: string; room: RoomLive; seat: Seat } | null {
    for (const roomId of [PUBLIC_ROOM_ID, STAGING_ROOM_ID]) {
      const room = this.live(roomId);
      const seat = room.seats.get(userId);
      if (seat) return { roomId, room, seat };
    }
    return null;
  }

  private broadcastRoom(roomId: string): void {
    const players: RoomPlayerView[] = [...this.live(roomId).seats.values()].map((s) => ({
      id: s.user.id,
      name: s.user.displayName,
      ready: s.ready,
    }));
    this.broadcast(roomId, { type: 'room', roomId, players });
  }

  private remember(roomId: string, payload: unknown): void {
    const list = this.history.get(roomId) ?? [];
    list.push(payload);
    while (list.length > MAX_CHAT_HISTORY) list.shift();
    this.history.set(roomId, list);
  }

  private broadcast(roomId: string, payload: unknown): void {
    const body = JSON.stringify(payload);
    for (const seat of this.live(roomId).seats.values()) seat.send(body);
  }
}
