/**
 * The domain model. System design §4–8.
 *
 *     Song  →  Beatmap  →  ChartRevision
 *
 * These are three things, not three views of one thing, and the previous build
 * treated them as one flat `Chart`. The consequences were concrete: two people
 * could not chart the same song, re-charting destroyed the earlier attempt, and
 * a title lived in the same object as the notes so editing one meant rewriting
 * the other.
 *
 * | Song          | the external media          | one per YouTube video |
 * | Beatmap       | someone's reading of it     | many per song         |
 * | ChartRevision | the actual notes and timing | many per beatmap      |
 */
import type {
  BeatmapId,
  PlaylistId,
  RevisionId,
  SongId,
  UserId,
} from './ids.ts';

// ---------------------------------------------------------------- media ----

export const MEDIA_PROVIDERS = ['youtube'] as const;
export type MediaProviderName = (typeof MEDIA_PROVIDERS)[number];

/**
 * What a provider hands back when asked to resolve a link. System design §11.
 *
 * Deliberately not a `Song`: this is what the provider knows, before anything
 * has been stored. `bpmHint` is a *suggestion* and never authoritative — an
 * external BPM does not say where beat one falls, which is the half that
 * actually matters for a chart.
 */
export interface MediaSource {
  provider: MediaProviderName;
  providerMediaId: string;
  title: string;
  creator?: string;
  durationMs?: number;
  thumbnailUrl?: string;
  bpmHint?: number;
}

/** External media, as stored. The internal id is independent of the provider's. */
export interface Song {
  id: SongId;
  provider: MediaProviderName;
  providerMediaId: string;
  title: string;
  artist: string;
  durationMs: number;
  thumbnailUrl?: string;
  createdAtIso: string;
}

// ---------------------------------------------------------------- notes ----

/**
 * A lane is a DIRECTION, never a key. ADR-001.
 *
 * `W` and `↑` both mean `up`, interchangeably, even within one song. Physical
 * keys are mapped to lanes by the input layer before anything reaches Game
 * Core, so a future rebinding cannot invalidate a single stored note.
 */
export const LANES = ['left', 'down', 'up', 'right'] as const;
export type Lane = (typeof LANES)[number];

export const NOTE_TYPES = ['tap', 'hold'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/**
 * One thing the player has to do.
 *
 * **`timeMs` is an absolute media time.** ADR-003: the timing map describes the
 * grid these were authored against and is never added to a note time at
 * playback. Applying both would put every note out by the offset, and the only
 * thing preventing that in the previous build was a convention in the
 * generator.
 */
export interface Note {
  id: string;
  timeMs: number;
  lane: Lane;
  type: NoteType;
  /** Required for `hold`, absent for `tap`. */
  durationMs?: number;
}

// --------------------------------------------------------------- timing ----

/**
 * Where the musical grid sits, from a given moment on. System design §7.
 *
 * A single bpm+offset cannot describe a song that changes tempo, or a recording
 * that drifts. A list of anchors can, and it degrades gracefully: one point at
 * `timeMs: 0` is exactly the simple case.
 *
 * `beat` is the beat number this point anchors, which is what lets a later
 * point re-align a drifting recording without moving everything before it.
 */
export interface TimingPoint {
  timeMs: number;
  bpm: number;
  beat: number;
}

/** At least one point, ordered by `timeMs`. The first should be the song's start. */
export type TimingMap = readonly TimingPoint[];

// -------------------------------------------------------------- beatmaps ----

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const BEATMAP_STATUSES = ['draft', 'published'] as const;
export type BeatmapStatus = (typeof BEATMAP_STATUSES)[number];

/** Someone's playable interpretation of a song. Many per song. */
export interface Beatmap {
  id: BeatmapId;
  songId: SongId;
  authorId: UserId;
  title?: string;
  difficulty: Difficulty;
  tags: readonly string[];
  status: BeatmapStatus;
  currentRevisionId?: RevisionId;
  createdAtIso: string;
  publishedAtIso?: string;
}

/**
 * The actual gameplay. **Immutable once published** — system design §6.
 *
 * Editing a published chart creates the next revision rather than changing this
 * one, so a beatmap someone saved a month ago keeps playing the way it played
 * when they saved it.
 *
 * `generatorVersion` and `generatorSeed` are for debugging and reproducibility
 * only. The notes are persisted because the generator will change, and a
 * published chart must not change with it (§8).
 */
export interface ChartRevision {
  id: RevisionId;
  beatmapId: BeatmapId;
  schemaVersion: number;
  revision: number;
  timing: TimingMap;
  notes: readonly Note[];
  generatorVersion?: string;
  generatorSeed?: number;
  createdAtIso: string;
}

export const CHART_SCHEMA_VERSION = 2;

/**
 * Everything needed to play, resolved. Not a stored entity.
 *
 * The three tables have to be joined before a round can start, and passing
 * three arguments everywhere invites passing them in the wrong order — which
 * branded ids catch, but only if they are separate arguments to begin with.
 */
export interface PlayableChart {
  song: Song;
  beatmap: Beatmap;
  revision: ChartRevision;
}

// ------------------------------------------------------- people and lists ----

export interface User {
  id: UserId;
  displayName: string;
  createdAtIso: string;
}

/**
 * A saved beatmap is a REFERENCE, not a copy. System design §17.
 *
 * Save points at someone else's beatmap. To change it you Fork, which creates
 * your own beatmap with its own author and its own revision history. Copying on
 * Save would duplicate every note and detach the copy from its author's fixes.
 */
export interface LibraryEntry {
  userId: UserId;
  beatmapId: BeatmapId;
  savedAtIso: string;
}

export interface Playlist {
  id: PlaylistId;
  userId: UserId;
  name: string;
}

/** Ordered. The playlist references charts; it does not own them (§18). */
export interface PlaylistItem {
  playlistId: PlaylistId;
  beatmapId: BeatmapId;
  position: number;
}

/** A row in the Global catalogue: enough to choose, not enough to play. */
export interface BeatmapSummary {
  beatmapId: BeatmapId;
  songId: SongId;
  revisionId: RevisionId;
  title: string;
  artist: string;
  authorId: UserId;
  authorName: string;
  difficulty: Difficulty;
  tags: readonly string[];
  noteCount: number;
  durationMs: number;
  thumbnailUrl?: string;
  publishedAtIso?: string;
}
