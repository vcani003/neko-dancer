/**
 * `@neko/server` — persistence and cookie identity.
 *
 * Phase 3 is this package talking to Postgres (PGlite in tests). HTTP
 * and the in-memory Public/Staging hub live here too.
 * `@neko/protocol` is the only domain this file is allowed to speak.
 */
export { Store } from './store.ts';
export type { CreateBeatmapInput, CreateSongInput, WriteRevisionInput } from './store.ts';
export { openMemoryDb, openFileDb } from './db/client.ts';
export type { Database, OpenDb } from './db/client.ts';
export { systemClock, frozenClock } from './db/clock.ts';
export type { Clock } from './db/clock.ts';
export { NotFoundError, ConflictError, ValidationError } from './errors.ts';
export {
  IDENTITY_COOKIE,
  IDENTITY_MAX_AGE_SEC,
  parseIdentityCookie,
  serialiseIdentityCookie,
} from './identity/cookie.ts';
export { resolveIdentity } from './identity/resolve.ts';
export type { ResolvedIdentity } from './identity/resolve.ts';
export {
  seedLibrary,
  SEED_AUTHOR_ID,
  SEED_SONG_ID,
  SEED_BEATMAP_ID,
  SEED_REVISION_ID,
} from './seed.ts';
export { importV1Dump, parseV1Dump, IMPORT_AUTHOR_ID } from './import/v1.ts';
export type { ImportResult } from './import/v1.ts';
export { handleApi } from './http/api.ts';
export type { HttpRequest, HttpResponse } from './http/api.ts';
export { RoomHub, PUBLIC_ROOM_ID, STAGING_ROOM_ID, PUBLIC_CAP } from './rooms/hub.ts';
export type { RoomListing, RoomPlayerView, JoinResult, LeaveResult, FinishResult } from './rooms/hub.ts';
