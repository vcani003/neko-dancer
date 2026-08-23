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
  readonly participantId: ParticipantId;
  readonly userId: UserId;
  readonly displayName: string;
  readonly ready: boolean;
  readonly finished: boolean;
  readonly media: MediaState;
  /** Server-chosen wording. Absent unless `media` is `failed`. */
  readonly mediaError?: string;
  /**
   * Whether this player is in the round at all. §21, §26.
   *
   * §21 gates the start on "every **participating** player", and without this
   * there is no such notion — so a player whose video will not load either
   * blocks the room for ever or is silently ignored by ad-hoc logic in one
   * place and not another. All three policies §26 leaves open (skip, spectate,
   * drop from the ready requirement) are expressed by this one field.
   */
  readonly participating: boolean;
  /**
   * False while they are away and their seat is held.
   *
   * A disconnect and a departure are different events with different correct
   * responses, and without this they are the same event.
   */
  readonly connected: boolean;
  readonly progress: PlayerProgress;
}

export interface QueueItem {
  /**
   * Identifies the ENTRY, not the beatmap.
   *
   * Nothing forbids queueing the same song twice, so keying removal on
   * `beatmapId` makes "remove that one" ambiguous — and gives no way to check
   * that the person removing it is the person who added it.
   */
  readonly queueItemId: string;
  readonly beatmapId: BeatmapId;
  readonly revisionId: RevisionId;
  readonly title: string;
  readonly artist: string;
  readonly addedBy: string;
  readonly addedByUserId: UserId;
}

export interface RoomState {
  readonly roomId: RoomId;
  readonly players: readonly RoomPlayer[];
  readonly queue: readonly QueueItem[];
  readonly activeRevisionId: RevisionId | null;
  readonly roundState: RoundState;
}

// ------------------------------------------------------ client → server ----

export type ClientMessage =
  | { type: 'join'; roomId: RoomId }
  | { type: 'leave' }
  /** Text only. The server knows who sent it (§27). */
  | { type: 'chat'; text: string }
  | { type: 'queueAdd'; beatmapId: BeatmapId }
  | { type: 'queueRemove'; queueItemId: string }
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
  /**
   * Fetch this revision and load its media; report back with `mediaResult`.
   * `deadlineInMs` is how long the room will wait before deciding for you —
   * without it, one silent client leaves everybody in `preparing` for ever.
   */
  | { type: 'roundPrepare'; revisionId: RevisionId; deadlineInMs: number }
  /** ADR-002: a delay from receipt, not an instant on the server's clock. */
  | { type: 'roundStart'; revisionId: RevisionId; startInMs: number }
  | { type: 'roundEnd'; results: readonly RoundScore[] }
  /**
   * The round is not happening after all.
   *
   * Distinct from `roundEnd`, which reports scores. A countdown that everyone
   * is watching has to be cancellable — the last able player leaving during it
   * is the obvious case — and without this message their clients count down to
   * a round that will never start.
   */
  | { type: 'roundAbort'; reason: string }
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
  readonly id: number;
  readonly text: string;
  readonly sentAtIso: string;
  readonly userId?: UserId;
  readonly displayName?: string;
  readonly system?: true;
}

export interface RoundScore {
  readonly participantId: ParticipantId;
  readonly displayName: string;
  readonly rank: number;
  /**
   * Null when they never reported one.
   *
   * Did-not-finish and failed-out are different outcomes and were previously
   * conflated: `RoundResult.completed: false` means "health ran out", which is
   * a run that happened. Someone whose browser closed produced no run at all.
   */
  readonly result: RoundResult | null;
  readonly best: Judgment | null;
}

// ------------------------------------------------------------- helpers ----

export type ClientMessageType = ClientMessage['type'];
export type ServerMessageType = ServerMessage['type'];

/**
 * Narrow a union member by its tag, so handlers stay exhaustively checked.
 *
 * Named `MessageOfType` rather than `Extract` because this package re-exports
 * everything through `index.ts`, and a type called `Extract` shadows the
 * TypeScript built-in for every file that imports from it — a confusing thing
 * to inflict on a consumer for the sake of four characters.
 */
export type MessageOfType<M extends { type: string }, T extends M['type']> = M & { type: T };
