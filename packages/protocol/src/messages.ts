/**
 * Every message that crosses the socket, as one discriminated union per
 * direction. System design §19–28.
 *
 * Three rules are encoded in the types rather than left to discipline:
 *
 * 1. **The server never receives an identity from the client.** No message
 *    carries a `userId` or a `displayName`; the socket is already authenticated
 *    and the server knows who owns it. A client that could name itself in a
 *    payload could name someone else (§27).
 * 2. **The server never sends a chart over the socket.** It sends a
 *    `RevisionId`; each client fetches the revision and loads the media itself
 *    (§22). A chart in a broadcast is tens of kilobytes multiplied by the room.
 * 3. **A round starts as a delay, not a timestamp** (ADR-002). Two machines'
 *    clocks differ by seconds; a duration means the same thing on both.
 */
import type { BeatmapId, ParticipantId, RevisionId, RoomId, UserId } from './ids.ts';
import type { Judgment, PlayerProgress, RoundResult } from './judgments.ts';

// ---------------------------------------------------------- room state ----

export const ROUND_STATES = ['lobby', 'preparing', 'countdown', 'playing', 'results'] as const;
export type RoundState = (typeof ROUND_STATES)[number];

/**
 * Whether a player's browser can actually play the current song. §26.
 *
 * `unknown` until that browser has tried. Restrictions are per viewer — region,
 * age, and the uploader's embedding setting — so this is a question only each
 * client can answer, and it must be answered in the lobby rather than
 * discovered during a countdown.
 */
export const MEDIA_STATES = ['unknown', 'ready', 'failed'] as const;
export type MediaState = (typeof MEDIA_STATES)[number];

/**
 * A participant, as everyone in the room sees them.
 *
 * `displayName` is a **snapshot taken at join** and cannot change while they
 * remain in the room (§28) — a name that shifts mid-round makes a scoreboard
 * unreadable and a chat log unciteable.
 */
export interface RoomPlayer {
  participantId: ParticipantId;
  userId: UserId;
  displayName: string;
  ready: boolean;
  finished: boolean;
  media: MediaState;
  /** Server-chosen wording. Absent unless `media` is `failed`. */
  mediaError?: string;
  progress: PlayerProgress;
}

export interface QueueItem {
  beatmapId: BeatmapId;
  revisionId: RevisionId;
  title: string;
  artist: string;
  addedBy: string;
  addedByUserId: UserId;
}

export interface RoomState {
  roomId: RoomId;
  players: readonly RoomPlayer[];
  queue: readonly QueueItem[];
  activeRevisionId: RevisionId | null;
  roundState: RoundState;
}

// ------------------------------------------------------ client → server ----

export type ClientMessage =
  | { type: 'join'; roomId: RoomId }
  | { type: 'leave' }
  /** Text only. The server knows who sent it (§27). */
  | { type: 'chat'; text: string }
  | { type: 'queueAdd'; beatmapId: BeatmapId }
  | { type: 'queueRemove'; beatmapId: BeatmapId }
  | { type: 'ready'; ready: boolean }
  /**
   * The answer to "can you play this?", tied to the revision it is about — so a
   * late reply about a song the room has moved on from cannot disqualify anyone
   * from the current one.
   */
  | { type: 'mediaResult'; revisionId: RevisionId; ok: boolean; reason?: MediaFailure }
  | { type: 'progress'; progress: PlayerProgress }
  | { type: 'finish'; result: RoundResult };

/**
 * Why a client could not play the media.
 *
 * A **code**, never a sentence. The server owns the wording, because these are
 * rendered as system messages and a system message looks authoritative — a
 * client able to write its own could post official-looking text to the room.
 */
export const MEDIA_FAILURES = [
  'embedBlocked',
  'unavailable',
  'badId',
  'playerFailed',
  'unknown',
] as const;
export type MediaFailure = (typeof MEDIA_FAILURES)[number];

// ------------------------------------------------------ server → client ----

export type ServerMessage =
  | { type: 'welcome'; participantId: ParticipantId; userId: UserId }
  | { type: 'room'; room: RoomState }
  | { type: 'chat'; message: ChatMessage }
  /** Fetch this revision and load its media; report back with `mediaResult`. */
  | { type: 'roundPrepare'; revisionId: RevisionId }
  /** ADR-002: a delay from receipt, not an instant on the server's clock. */
  | { type: 'roundStart'; revisionId: RevisionId; startInMs: number }
  | { type: 'roundEnd'; results: readonly RoundScore[] }
  | { type: 'error'; error: string };

/**
 * Chat, as the server produces it. §27.
 *
 * The client sends `{ text }`. Everything else is added here, from the socket's
 * own identity — which is what makes impersonation impossible rather than
 * merely discouraged. `system` lines have no author and are always the
 * server's own words.
 */
export interface ChatMessage {
  id: number;
  text: string;
  sentAtIso: string;
  userId?: UserId;
  displayName?: string;
  system?: true;
}

export interface RoundScore {
  participantId: ParticipantId;
  displayName: string;
  rank: number;
  result: RoundResult;
  best: Judgment | null;
}

// ------------------------------------------------------------- helpers ----

export type ClientMessageType = ClientMessage['type'];
export type ServerMessageType = ServerMessage['type'];

/** Narrow a union member by its tag, so handlers stay exhaustively checked. */
export type Extract<M extends { type: string }, T extends M['type']> = M & { type: T };
