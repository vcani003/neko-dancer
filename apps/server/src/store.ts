/**
 * The Phase 3 surface: persist the domain, and nothing else.
 *
 * No HTTP, no rooms, no YouTube. A `Store` is what a later Fastify route
 * will call. Tests talk to it directly, which is why the Phase 3 gate can
 * be proven on PGlite without a server process.
 *
 * Revisions are insert-only. There is no `updateRevision`. Publishing a
 * second time writes revision 2 and leaves revision 1 byte-identical.
 * Save writes a reference; Fork writes a new beatmap. Those two are the
 * whole of system design §17, and they are the tests that keep it so.
 */
import { and, desc, eq } from 'drizzle-orm';
import {
  CHART_SCHEMA_VERSION,
  cleanDisplayName,
  cleanSongMetadata,
  MAX_NOTE_TIME_MS,
  MEDIA_PROVIDERS,
  newId,
  sanitiseText,
  validateBeatmapMetadata,
  validateChartRevision,
  validateRoundResult,
  type Beatmap,
  type BeatmapId,
  type BeatmapSummary,
  type ChartRevision,
  type Difficulty,
  type LibraryEntry,
  type MediaProviderName,
  type Note,
  type PlayableChart,
  type RevisionId,
  type ScoreId,
  type Song,
  type SongId,
  type StoredScore,
  type TimingMap,
  type User,
  type UserId,
} from '@neko/protocol';
import type { Clock } from './db/clock.ts';
import { systemClock } from './db/clock.ts';
import type { Database } from './db/client.ts';
import { beatmaps, chartRevisions, libraryEntries, scores, songs, users } from './db/schema.ts';
import { ConflictError, NotFoundError, ValidationError } from './errors.ts';
import { toBeatmap, toLibraryEntry, toRevision, toScore, toSong, toUser } from './mappers.ts';

const MAX_MEDIA_ID_LENGTH = 200;
const MAX_THUMBNAIL_LENGTH = 500;

export interface CreateSongInput {
  id?: SongId;
  provider: MediaProviderName;
  providerMediaId: string;
  title?: unknown;
  artist?: unknown;
  durationMs: number;
  thumbnailUrl?: string;
}

export interface CreateBeatmapInput {
  id?: BeatmapId;
  songId: SongId;
  authorId: UserId;
  title?: unknown;
  difficulty: Difficulty;
  tags?: unknown;
  forkedFromBeatmapId?: BeatmapId;
  forkedFromRevisionId?: RevisionId;
}

export interface WriteRevisionInput {
  id?: RevisionId;
  timing: unknown;
  notes: unknown;
  generatorVersion?: string;
  generatorSeed?: number;
}

export class Store {
  readonly db: Database;
  readonly clock: Clock;

  constructor(db: Database, clock: Clock = systemClock) {
    this.db = db;
    this.clock = clock;
  }

  private now(): Date {
    return this.clock.now();
  }

  // ---------------------------------------------------------------- users ----

  async createUser(input: { id?: UserId; displayName?: unknown } = {}): Promise<User> {
    const id = input.id ?? newId<UserId>();
    const displayName = cleanDisplayName(input.displayName);
    const createdAt = this.now();
    await this.db.insert(users).values({ id, displayName, createdAt });
    const row = await this.getUser(id);
    if (!row) throw new Error('insert user vanished');
    return row;
  }

  async getUser(id: UserId): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUser(row) : null;
  }

  async renameUser(id: UserId, displayName: unknown): Promise<User> {
    const existing = await this.getUser(id);
    if (!existing) throw new NotFoundError('No such user.');
    const cleaned = cleanDisplayName(displayName);
    await this.db.update(users).set({ displayName: cleaned }).where(eq(users.id, id));
    const row = await this.getUser(id);
    if (!row) throw new Error('rename vanished');
    return row;
  }

  // ---------------------------------------------------------------- songs ----

  async createSong(input: CreateSongInput): Promise<Song> {
    if (!MEDIA_PROVIDERS.includes(input.provider)) {
      throw new ValidationError([`Unknown provider "${String(input.provider)}".`]);
    }
    const providerMediaId = sanitiseText(input.providerMediaId, MAX_MEDIA_ID_LENGTH);
    if (!providerMediaId) throw new ValidationError(['`providerMediaId` must contain something readable.']);
    if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > MAX_NOTE_TIME_MS) {
      throw new ValidationError(['`durationMs` must be a song length.']);
    }
    const { title, artist } = cleanSongMetadata(input);
    const thumbnailUrl = cleanThumbnail(input.thumbnailUrl);
    const id = input.id ?? newId<SongId>();
    const createdAt = this.now();

    const existing = await this.findSongByMedia(input.provider, providerMediaId);
    if (existing) throw new ConflictError('That media is already a song.');

    await this.db.insert(songs).values({
      id,
      provider: input.provider,
      providerMediaId,
      title,
      artist,
      durationMs: input.durationMs,
      thumbnailUrl,
      createdAt,
    });
    const row = await this.getSong(id);
    if (!row) throw new Error('insert song vanished');
    return row;
  }

  async getSong(id: SongId): Promise<Song | null> {
    const [row] = await this.db.select().from(songs).where(eq(songs.id, id)).limit(1);
    return row ? toSong(row) : null;
  }

  async findSongByMedia(provider: MediaProviderName, providerMediaId: string): Promise<Song | null> {
    const [row] = await this.db
      .select()
      .from(songs)
      .where(and(eq(songs.provider, provider), eq(songs.providerMediaId, providerMediaId)))
      .limit(1);
    return row ? toSong(row) : null;
  }

  // ------------------------------------------------------------- beatmaps ----

  async createBeatmap(input: CreateBeatmapInput): Promise<Beatmap> {
    if (!(await this.getSong(input.songId))) throw new NotFoundError('No such song.');
    if (!(await this.getUser(input.authorId))) throw new NotFoundError('No such author.');

    const meta = validateBeatmapMetadata({
      title: input.title,
      difficulty: input.difficulty,
      status: 'draft',
      tags: input.tags ?? [],
    });
    if (!meta.ok) throw new ValidationError(meta.errors);

    const id = input.id ?? newId<BeatmapId>();
    const createdAt = this.now();
    await this.db.insert(beatmaps).values({
      id,
      songId: input.songId,
      authorId: input.authorId,
      title: meta.value.title ?? null,
      difficulty: meta.value.difficulty,
      tags: [...meta.value.tags],
      status: 'draft',
      currentRevisionId: null,
      createdAt,
      publishedAt: null,
      forkedFromBeatmapId: input.forkedFromBeatmapId ?? null,
      forkedFromRevisionId: input.forkedFromRevisionId ?? null,
    });
    const row = await this.getBeatmap(id);
    if (!row) throw new Error('insert beatmap vanished');
    return row;
  }

  async getBeatmap(id: BeatmapId): Promise<Beatmap | null> {
    const [row] = await this.db.select().from(beatmaps).where(eq(beatmaps.id, id)).limit(1);
    return row ? toBeatmap(row) : null;
  }

  /**
   * Insert a revision. Never updates one.
   *
   * The notes are persisted because the generator will change. A published
   * chart must not change with it — system design §8 — and the only way to
   * keep that is to refuse to write over a row that already exists.
   */
  async writeRevision(beatmapId: BeatmapId, input: WriteRevisionInput): Promise<ChartRevision> {
    if (!(await this.getBeatmap(beatmapId))) throw new NotFoundError('No such beatmap.');

    const latest = await this.db
      .select({ revision: chartRevisions.revision })
      .from(chartRevisions)
      .where(eq(chartRevisions.beatmapId, beatmapId))
      .orderBy(desc(chartRevisions.revision))
      .limit(1);
    const revision = (latest[0]?.revision ?? 0) + 1;
    const id = input.id ?? newId<RevisionId>();
    const createdAt = this.now();

    const checked = validateChartRevision({
      id,
      beatmapId,
      schemaVersion: CHART_SCHEMA_VERSION,
      revision,
      timing: input.timing,
      notes: input.notes,
      ...(input.generatorVersion ? { generatorVersion: input.generatorVersion } : {}),
      ...(input.generatorSeed !== undefined ? { generatorSeed: input.generatorSeed } : {}),
      createdAtIso: createdAt.toISOString(),
    });
    if (!checked.ok) throw new ValidationError(checked.errors);

    await this.db.insert(chartRevisions).values({
      id: checked.value.id,
      beatmapId: checked.value.beatmapId,
      schemaVersion: checked.value.schemaVersion,
      revision: checked.value.revision,
      timing: checked.value.timing as TimingMap,
      notes: checked.value.notes as Note[],
      generatorVersion: checked.value.generatorVersion ?? null,
      generatorSeed: checked.value.generatorSeed ?? null,
      createdAt,
    });
    await this.db
      .update(beatmaps)
      .set({ currentRevisionId: checked.value.id })
      .where(eq(beatmaps.id, beatmapId));

    const row = await this.getRevision(checked.value.id);
    if (!row) throw new Error('insert revision vanished');
    return row;
  }

  async getRevision(id: RevisionId): Promise<ChartRevision | null> {
    const [row] = await this.db.select().from(chartRevisions).where(eq(chartRevisions.id, id)).limit(1);
    return row ? toRevision(row) : null;
  }

  async publish(beatmapId: BeatmapId): Promise<Beatmap> {
    const beatmap = await this.getBeatmap(beatmapId);
    if (!beatmap) throw new NotFoundError('No such beatmap.');
    if (!beatmap.currentRevisionId) throw new ValidationError(['A beatmap needs a revision before it can be published.']);

    const publishedAt = beatmap.publishedAtIso ? new Date(beatmap.publishedAtIso) : this.now();
    await this.db
      .update(beatmaps)
      .set({ status: 'published', publishedAt })
      .where(eq(beatmaps.id, beatmapId));
    const row = await this.getBeatmap(beatmapId);
    if (!row) throw new Error('publish vanished');
    return row;
  }

  /**
   * Fork is a new beatmap with its own author and its own revision 1.
   * The source is untouched. That is the difference from Save.
   */
  async fork(sourceId: BeatmapId, authorId: UserId): Promise<{ beatmap: Beatmap; revision: ChartRevision }> {
    const source = await this.getBeatmap(sourceId);
    if (!source) throw new NotFoundError('No such beatmap.');
    if (!source.currentRevisionId) throw new ValidationError(['Nothing to fork — that beatmap has no revision.']);
    const sourceRevision = await this.getRevision(source.currentRevisionId);
    if (!sourceRevision) throw new NotFoundError('No such revision.');
    if (!(await this.getUser(authorId))) throw new NotFoundError('No such author.');

    const beatmap = await this.createBeatmap({
      songId: source.songId,
      authorId,
      title: source.title,
      difficulty: source.difficulty,
      tags: [...source.tags],
      forkedFromBeatmapId: source.id,
      forkedFromRevisionId: sourceRevision.id,
    });
    const revision = await this.writeRevision(beatmap.id, {
      timing: sourceRevision.timing,
      notes: sourceRevision.notes,
      generatorVersion: sourceRevision.generatorVersion,
      generatorSeed: sourceRevision.generatorSeed,
    });
    return { beatmap, revision };
  }

  // -------------------------------------------------------------- library ----

  /** Save is a reference. The beatmap stays someone else's. */
  async save(userId: UserId, beatmapId: BeatmapId): Promise<LibraryEntry> {
    if (!(await this.getUser(userId))) throw new NotFoundError('No such user.');
    if (!(await this.getBeatmap(beatmapId))) throw new NotFoundError('No such beatmap.');

    const already = await this.db
      .select()
      .from(libraryEntries)
      .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.beatmapId, beatmapId)))
      .limit(1);
    if (already[0]) return toLibraryEntry(already[0]);

    const savedAt = this.now();
    await this.db.insert(libraryEntries).values({ userId, beatmapId, savedAt });
    const [row] = await this.db
      .select()
      .from(libraryEntries)
      .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.beatmapId, beatmapId)))
      .limit(1);
    if (!row) throw new Error('insert library vanished');
    return toLibraryEntry(row);
  }

  async listLibrary(userId: UserId): Promise<LibraryEntry[]> {
    const rows = await this.db.select().from(libraryEntries).where(eq(libraryEntries.userId, userId));
    return rows.map(toLibraryEntry);
  }

  // --------------------------------------------------------------- scores ----

  async recordScore(userId: UserId, revisionId: RevisionId, result: unknown): Promise<StoredScore> {
    if (!(await this.getUser(userId))) throw new NotFoundError('No such user.');
    if (!(await this.getRevision(revisionId))) throw new NotFoundError('No such revision.');
    const checked = validateRoundResult(result);
    if (!checked.ok) throw new ValidationError(checked.errors);

    const id = newId<ScoreId>();
    const createdAt = this.now();
    await this.db.insert(scores).values({
      id,
      userId,
      revisionId,
      score: checked.value.score,
      combo: checked.value.combo,
      accuracy: checked.value.accuracy,
      health: checked.value.health,
      maxCombo: checked.value.maxCombo,
      counts: checked.value.counts,
      completed: checked.value.completed,
      createdAt,
    });
    const [row] = await this.db.select().from(scores).where(eq(scores.id, id)).limit(1);
    if (!row) throw new Error('insert score vanished');
    return toScore(row);
  }

  async listScoresForUser(userId: UserId): Promise<StoredScore[]> {
    const rows = await this.db
      .select()
      .from(scores)
      .where(eq(scores.userId, userId))
      .orderBy(desc(scores.createdAt));
    return rows.map(toScore);
  }

  // -------------------------------------------------------------- playable ----

  async getPlayable(revisionId: RevisionId): Promise<PlayableChart | null> {
    const revision = await this.getRevision(revisionId);
    if (!revision) return null;
    const beatmap = await this.getBeatmap(revision.beatmapId);
    if (!beatmap) return null;
    const song = await this.getSong(beatmap.songId);
    if (!song) return null;
    return { song, beatmap, revision };
  }

  async listPublished(): Promise<BeatmapSummary[]> {
    return this.listCatalog({ publishedOnly: true });
  }

  /** Home's shelf: drafts and published, anything with a revision. */
  async listAll(): Promise<BeatmapSummary[]> {
    return this.listCatalog({ publishedOnly: false });
  }

  private async listCatalog(options: { publishedOnly: boolean }): Promise<BeatmapSummary[]> {
    const rows = await this.db
      .select({
        beatmap: beatmaps,
        song: songs,
        author: users,
        revision: chartRevisions,
      })
      .from(beatmaps)
      .innerJoin(songs, eq(beatmaps.songId, songs.id))
      .innerJoin(users, eq(beatmaps.authorId, users.id))
      .innerJoin(chartRevisions, eq(beatmaps.currentRevisionId, chartRevisions.id));

    return rows
      .map(({ beatmap, song, author, revision }) => {
        const mapped = toBeatmap(beatmap);
        const mappedSong = toSong(song);
        const mappedRev = toRevision(revision);
        return {
          beatmapId: mapped.id,
          songId: mapped.songId,
          revisionId: mappedRev.id,
          title: mapped.title ?? mappedSong.title,
          artist: mappedSong.artist,
          authorId: mapped.authorId,
          authorName: toUser(author).displayName,
          difficulty: mapped.difficulty,
          tags: mapped.tags,
          noteCount: mappedRev.notes.length,
          durationMs: mappedSong.durationMs,
          status: mapped.status,
          ...(mappedSong.thumbnailUrl ? { thumbnailUrl: mappedSong.thumbnailUrl } : {}),
          ...(mapped.publishedAtIso ? { publishedAtIso: mapped.publishedAtIso } : {}),
        };
      })
      .filter((row) => (options.publishedOnly ? row.status === 'published' : true));
  }
}

function cleanThumbnail(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = sanitiseText(value, MAX_THUMBNAIL_LENGTH);
  if (!cleaned || !cleaned.startsWith('https://')) {
    throw new ValidationError(['`thumbnailUrl` must be an https URL.']);
  }
  return cleaned;
}
