/**
 * Every bound in one place, so both sides agree on them.
 *
 * A limit that lives only on the client is a suggestion. A limit that lives on
 * both sides but is written twice is two limits that will eventually differ.
 *
 * The rule that produced most of these: **measure the traffic a limit must
 * allow before choosing it.** A guessed message cap of 4 KB was once smaller
 * than a real chart, so it rejected the happy path — and, because an oversized
 * frame emits an error nobody was listening for, it took the server down. The
 * protection was the outage.
 */

/** Sized against the largest legitimate message, with room to spare. */
export const MAX_MESSAGE_BYTES = 512 * 1024;

export const MAX_DISPLAY_NAME_LENGTH = 20;
export const MAX_CHAT_LENGTH = 200;
export const MAX_TITLE_LENGTH = 100;
export const MAX_ARTIST_LENGTH = 100;
export const MAX_TAG_LENGTH = 24;
export const MAX_TAGS = 8;
export const MAX_PLAYLIST_NAME_LENGTH = 60;

/** A chart longer than this is not a song, it is a claim worth refusing. */
export const MAX_NOTES = 5000;
/** Six hours. Longer than any song, shorter than an accident. */
export const MAX_NOTE_TIME_MS = 6 * 60 * 60 * 1000;
export const MAX_TIMING_POINTS = 256;
export const MIN_BPM = 20;
export const MAX_BPM = 400;

export const MAX_PLAYERS_PER_ROOM = 16;
export const MAX_ROOMS = 32;
export const MAX_QUEUE_LENGTH = 20;
export const MAX_CHAT_HISTORY = 60;

/** Messages per socket per window, beyond which the socket is closed. */
export const RATE_LIMIT = 40;
export const RATE_WINDOW_MS = 2000;

/**
 * How long a round is given before it ends itself.
 *
 * A round ends when everyone reports finishing. A client that never reports —
 * a closed laptop, a video that would not load — otherwise leaves the room in
 * `playing` for ever, and readying is refused in that state. Any player could
 * therefore brick a room for everybody by readying and walking away, with no
 * malice required.
 */
export const ROUND_GRACE_MS = 90_000;

/** ADR-002: a relative delay, never a server timestamp. */
export const COUNTDOWN_MS = 3000;

/** A score above this is not a score. Bounds the damage of a bad claim. */
export const MAX_PLAUSIBLE_SCORE = 5_000_000;
