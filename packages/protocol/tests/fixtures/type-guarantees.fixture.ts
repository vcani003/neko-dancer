/**
 * Type-level guarantees, written as code that must compile — and code that must
 * NOT. Compiled by `type-guarantees.test.ts`, which fails if any of these
 * change behaviour.
 *
 * Every `@ts-expect-error` here is an assertion with teeth: if the line it
 * guards stops being an error, TypeScript reports the directive itself as
 * unused (TS2578) and the test goes red. A type-level guarantee that nothing
 * compiles is a comment.
 *
 * This file is never executed and is not a test file — it exists to be
 * type-checked.
 */
import {
  asId,
  newId,
  type Beatmap,
  type BeatmapId,
  type ChartRevision,
  type ClientMessage,
  type HoldNote,
  type MessageOfType,
  type Note,
  type ParticipantId,
  type RevisionId,
  type RoomId,
  type RoomState,
  type RoundResult,
  type ServerMessage,
  type Song,
  type SongId,
  type TapNote,
  type UserId,
} from '@neko/protocol';

declare const song: SongId;
declare const beatmap: BeatmapId;
declare const revision: RevisionId;
declare const user: UserId;
declare const participant: ParticipantId;

declare function playRevision(id: RevisionId): void;
declare function loadBeatmap(id: BeatmapId): void;
declare function findUser(id: UserId): void;

// ---------------------------------------------------------------------------
// 1. Ids of different kinds are not interchangeable — §4-6, §30.
//    All four identities are separate on purpose; the type system tells them
//    apart so a mix-up is a compile error rather than a 404 far from the cause.
// ---------------------------------------------------------------------------

playRevision(revision);
loadBeatmap(beatmap);
findUser(user);

// @ts-expect-error a SongId is not a BeatmapId
loadBeatmap(song);
// @ts-expect-error a BeatmapId is not a RevisionId
playRevision(beatmap);
// @ts-expect-error a UserId is not a ParticipantId — §28 keeps these separate
const wrongParticipant: ParticipantId = user;
// @ts-expect-error a ParticipantId is not a UserId
const wrongUser: UserId = participant;
// @ts-expect-error a raw string may not become an id without passing asId
const wrongRaw: BeatmapId = '9f2a4c1e-1111-4111-8111-111111111111';
// @ts-expect-error not even a correctly shaped uuid literal
const wrongLiteral: SongId = '00000000-0000-4000-8000-000000000000';

// An id IS a string, which is what makes it safe to log and to put in a URL.
const asString: string = beatmap;

// ---------------------------------------------------------------------------
// 2. asId is constrained to the ids that are actually UUIDs — SF-6.
//    `asId<RoomId>(x)` used to type-check and then return null for every valid
//    room id, for ever, silently: a boundary written the obvious way was dead
//    code. Room ids are human-typed and use `isRoomId` instead.
// ---------------------------------------------------------------------------

const okId = asId<BeatmapId>('9f2a4c1e-1111-4111-8111-111111111111');
// @ts-expect-error a RoomId is not a uuid, so asId cannot produce one
const roomViaAsId = asId<RoomId>('kitchen');
// @ts-expect-error nor can newId mint one
const roomViaNewId = newId<RoomId>();
// @ts-expect-error an arbitrary branded-looking type is not an id
const notAnId = asId<string & { readonly x: 1 }>('x');

// Without a type argument the result is unusable, so the kind cannot be skipped.
declare const unknownValue: unknown;
const unbranded = asId(unknownValue);
if (unbranded) {
  // @ts-expect-error the caller must name the kind it expects
  loadBeatmap(unbranded);
}

// ---------------------------------------------------------------------------
// 3. A tap and a hold are different shapes — SF-4.
//    "Required for hold, absent for tap" was true of the comment and of the
//    runtime validator, and false of the type.
// ---------------------------------------------------------------------------

const goodTap: TapNote = { id: 'n1', timeMs: 0, lane: 'up', type: 'tap' };
const goodHold: HoldNote = { id: 'n2', timeMs: 0, lane: 'up', type: 'hold', durationMs: 500 };

// @ts-expect-error a tap must not carry a duration
const tapWithDuration: TapNote = { id: 'n3', timeMs: 0, lane: 'up', type: 'tap', durationMs: 500 };
// @ts-expect-error a hold without a duration is not a hold
const holdWithoutDuration: HoldNote = { id: 'n4', timeMs: 0, lane: 'up', type: 'hold' };
// @ts-expect-error the same, through the union
const unionTapWithDuration: Note = { id: 'n5', timeMs: 0, lane: 'up', type: 'tap', durationMs: 1 };
// @ts-expect-error a lane is a direction, never a key — ADR-001
const keyAsLane: TapNote = { id: 'n6', timeMs: 0, lane: 'W', type: 'tap' };

// Narrowing on `type` reaches the duration without a cast.
function holdLength(note: Note): number {
  return note.type === 'hold' ? note.durationMs : 0;
}

// ---------------------------------------------------------------------------
// 4. A published revision is immutable — §6. So is a room snapshot — §28.
// ---------------------------------------------------------------------------

declare const storedRevision: ChartRevision;
declare const storedBeatmap: Beatmap;
declare const storedSong: Song;
declare const roomState: RoomState;
declare const reported: RoundResult;

// @ts-expect-error a published revision may not be edited in place
storedRevision.schemaVersion = 99;
// @ts-expect-error nor may its notes array be replaced
storedRevision.notes = [];
// @ts-expect-error nor may a note inside it be rewritten
storedRevision.notes[0]!.timeMs = 999_999;
// @ts-expect-error nor a timing point
storedRevision.timing[0]!.bpm = 400;
// @ts-expect-error a beatmap's author is not reassignable
storedBeatmap.authorId = user;
// @ts-expect-error nor its status
storedBeatmap.status = 'published';
// @ts-expect-error a song's provider id is fixed
storedSong.providerMediaId = 'hijacked';
// @ts-expect-error a display name cannot change while its owner is in the room
roomState.players[0]!.displayName = 'someone else';
// @ts-expect-error the queue is not reorderable in place
roomState.queue[0]!.title = 'something else';

/**
 * `RoomPlayer.progress` is a readonly REFERENCE to a mutable object:
 * `PlayerProgress` in `judgments.ts` still declares `score`, `combo`,
 * `accuracy` and `health` without `readonly`, so a score can be written into
 * another player's snapshot straight through it. Every other entity was made
 * readonly; this one was missed, and one mutable field reopens the hole the
 * rest were closed to prevent.
 */
// @ts-expect-error nor may a score be written into another player's snapshot
roomState.players[0]!.progress.score = 999_999;
// @ts-expect-error nor a max combo into a result somebody already reported
reported.maxCombo = 999_999;

// ---------------------------------------------------------------------------
// 5. Both message unions are exhaustively checkable.
//    The `never` assignment is what turns a new message type into a compile
//    error in every handler, rather than a silently ignored message.
// ---------------------------------------------------------------------------

function handleClient(message: ClientMessage): string {
  switch (message.type) {
    case 'join': return message.roomId;
    case 'leave': return 'leave';
    case 'chat': return message.text;
    case 'queueAdd': return message.beatmapId;
    case 'queueRemove': return message.queueItemId;
    case 'ready': return String(message.ready);
    case 'mediaResult': return message.revisionId;
    case 'progress': return String(message.progress.score);
    case 'finish': return String(message.result.completed);
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

function handleServer(message: ServerMessage): string {
  switch (message.type) {
    case 'welcome': return message.userId;
    case 'room': return message.room.roomId;
    case 'chat': return message.message.text;
    case 'roundPrepare': return String(message.deadlineInMs);
    case 'roundStart': return String(message.startInMs);
    case 'roundEnd': return String(message.results.length);
    case 'roundAbort': return message.reason;
    case 'error': return message.error;
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

// A switch that misses a case must NOT type-check as exhaustive — this is what
// proves the mechanism above is actually load-bearing.
function incompleteHandler(message: ClientMessage): string {
  switch (message.type) {
    case 'join': return message.roomId;
    case 'leave': return 'leave';
    default: {
      // @ts-expect-error seven message types are still unhandled
      const exhaustive: never = message;
      return String(exhaustive);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. MessageOfType narrows by tag, and does not shadow the built-in Extract.
//    A type called `Extract` exported through `index.ts` shadows the TypeScript
//    built-in for every file importing from this package.
// ---------------------------------------------------------------------------

function readChat(message: MessageOfType<ClientMessage, 'chat'>): string {
  return message.text;
}

function readStart(message: MessageOfType<ServerMessage, 'roundStart'>): number {
  return message.startInMs;
}

function misreadChat(message: MessageOfType<ClientMessage, 'chat'>): string {
  // @ts-expect-error a chat message has no roomId — the narrowing is real
  return message.roomId;
}

// @ts-expect-error 'nope' is not one of the declared message types
type NoSuchMessage = MessageOfType<ClientMessage, 'nope'>;

// The built-in Extract still means what it always meant.
type BuiltinStillWorks = Extract<'a' | 'b' | 'c', 'a' | 'b'>;
const builtin: BuiltinStillWorks = 'a';

// ---------------------------------------------------------------------------
// 7. The server never receives an identity from a client — §27.
//    Not one member of the client union carries a userId or a displayName, so
//    a client cannot name itself, or anyone else, in a payload.
// ---------------------------------------------------------------------------

type ClientKeys = ClientMessage extends unknown ? keyof ClientMessage : never;
// @ts-expect-error no client message has a userId
const noUserId: ClientKeys = 'userId';
// @ts-expect-error no client message has a displayName
const noDisplayName: ClientKeys = 'displayName';
// @ts-expect-error no client message may declare itself a system message
const noSystemFlag: ClientKeys = 'system';

export type { BuiltinStillWorks, ClientKeys, NoSuchMessage };
export {
  asString, builtin, goodHold, goodTap, handleClient, handleServer, holdLength,
  incompleteHandler, misreadChat, noDisplayName, noSystemFlag, noUserId, notAnId,
  okId, readChat, readStart, roomViaAsId, roomViaNewId, tapWithDuration,
  holdWithoutDuration, keyAsLane, unionTapWithDuration, wrongLiteral,
  wrongParticipant, wrongRaw, wrongUser,
};
