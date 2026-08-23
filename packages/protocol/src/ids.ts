/**
 * Identifiers.
 *
 * Every id is a string at runtime and a *distinct* type at compile time. That
 * distinction is the whole point: `SongId`, `BeatmapId` and `RevisionId` all
 * look identical in a debugger, they are passed through the same function
 * signatures, and confusing two of them produces a lookup that fails somewhere
 * far from where the mistake was made.
 *
 * The domain model has four separate identities on purpose — system design
 * §4–6 and §30 — so the type system should be able to tell them apart.
 *
 *     playRevision(beatmapId)   // ✗ compile error, not a 404 at runtime
 *
 * Ids are opaque. Nothing outside the database may parse one, derive one, or
 * assume a shape. The previous build constructed them by hand
 * (`youtube:abc#vero#v2`), which meant a rename changed an identity and a
 * parser existed in three places.
 */

declare const brand: unique symbol;

/** A string that has been checked, and may not be swapped for another kind. */
type Branded<Name extends string> = string & { readonly [brand]: Name };

export type UserId = Branded<'UserId'>;
export type SongId = Branded<'SongId'>;
export type BeatmapId = Branded<'BeatmapId'>;
export type RevisionId = Branded<'RevisionId'>;
export type PlaylistId = Branded<'PlaylistId'>;
export type RoomId = Branded<'RoomId'>;
/** Identifies a socket's participant within one room. Never a `UserId`. */
export type ParticipantId = Branded<'ParticipantId'>;

/**
 * The shape every generated id must have.
 *
 * UUID v4, lowercase, hyphenated — and the `4` is checked, not just described.
 * The variant nibble was enforced while the version was not, so a v1 (which
 * encodes a MAC address and a timestamp) passed a function whose whole purpose
 * is untrusted input. Fixed length and a closed character set,
 * which is what makes an id safe to put in a URL, a filename or a log line
 * without escaping it. `RoomId` is the one exception — see below.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Room ids are human-typed, so they are the exception.
 *
 * Someone tells a friend "join `kitchen`" out loud. That cannot be a UUID. It
 * is therefore the one identifier a person controls, which makes it the one
 * that needs a character allowlist rather than a format check — a room id has
 * historically been the thing that ends up in a path.
 */
const ROOM_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;

export function isRoomId(value: unknown): value is RoomId {
  return typeof value === 'string' && ROOM_ID.test(value);
}

/**
 * Normalise something a person typed into a room id, or fail.
 *
 * Returns null rather than a fallback: silently sending someone to a different
 * room than they typed is worse than telling them the name is unusable.
 */
export function toRoomId(input: string): RoomId | null {
  const normalised = input.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return isRoomId(normalised) ? (normalised as RoomId) : null;
}

/**
 * The ids that are UUIDs. `RoomId` is deliberately not among them.
 *
 * `asId` used to accept any branded type, which meant `asId<RoomId>(x)`
 * type-checked and then returned null for every valid room id, for ever,
 * silently — a boundary written the obvious way was dead code.
 */
export type UuidId = UserId | SongId | BeatmapId | RevisionId | PlaylistId | ParticipantId;

/**
 * Turn an untrusted string into a branded id, or fail.
 *
 * Checks the UUID *shape*. It cannot check the *kind* — a `SongId` and a
 * `BeatmapId` are the same 36 characters at runtime — so the caller names the
 * kind it is expecting and is trusted about that one thing. Everywhere past a
 * boundary, ids arrive already typed and the compiler keeps them apart.
 */
export function asId<T extends UuidId>(value: unknown): T | null {
  return isUuid(value) ? (value as T) : null;
}

/** Mint a new id. The one sanctioned way to create one. */
export function newId<T extends UuidId>(): T {
  return crypto.randomUUID() as T;
}
