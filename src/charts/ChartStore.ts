/**
 * Charts, kept so a song is only ever charted once.
 *
 * This is the piece the original calls "Processing": a song added for the
 * first time gets its notes worked out, and every play after that reuses them.
 * hop//beat's spec §8 reached the same conclusion from the other direction —
 * derive the timing once, cache it, and never make analysis a dependency of
 * normal play.
 *
 * What is stored is the CHART: note times, lanes, tempo. Not the recording,
 * not any audio, not a single sample. A chart is a description of when to move
 * — it is ours, it is tiny, and storing it raises none of the questions storing
 * the music would (§11).
 *
 * ## Identity
 *
 * This used to be keyed by playback source alone, which said "one song, one
 * chart" — so re-tapping a song destroyed the previous attempt, and two
 * people's readings of the same song could not both exist. Neither survives
 * contact with a library that several people write to.
 *
 * Three identifiers now, and they answer different questions:
 *
 * | `songKey`  | `youtube:kJQP7kiw5Fk`          | which song is this          |
 * | `chartId`  | `youtube:kJQP7kiw5Fk#vero#v2`  | which beatmap of it         |
 * | `author`   | `vero`                         | whose reading it is         |
 *
 * Local storage today. The interface is deliberately async and narrow so the
 * same calls can hit a server later, which is what makes a chart charted by
 * one person playable by everyone.
 */
import type { Chart } from './schema.ts';
import { validateChart } from './validator.ts';

const STORAGE_PREFIX = 'neko.chart.';

/** The song a chart is written for — not the chart itself. */
export function songKey(chart: Chart): string {
  return playbackKey(chart.song.playback);
}

export function playbackKey(playback: Chart['song']['playback']): string {
  switch (playback.provider) {
    case 'youtube':
      return `youtube:${playback.videoId}`;
    case 'localAudio':
      return `local:${playback.src}`;
    case 'clickTrack':
      return `click:${playback.bpm}`;
  }
}

/**
 * An author's name reduced to something safe to put inside an identifier.
 *
 * Names are chosen freely and will eventually reach a filename on the server,
 * so this is an allowlist rather than a blocklist: anything outside
 * `[a-z0-9-]` is replaced, never merely escaped. In particular it can produce
 * neither `#` (the separator below) nor `/`, `\` or `.` (a path).
 */
export function authorSlug(name: string | undefined): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug || 'anon';
}

export interface ChartIdentity {
  songKey: string;
  /** Already slugged. */
  author: string;
  version: number;
}

/**
 * `<songKey>#<author>#v<n>`.
 *
 * `#` is the separator because a songKey contains `:` and an author slug
 * cannot contain either, so the split is unambiguous from the right.
 */
export function chartId(identity: ChartIdentity): string {
  return `${identity.songKey}#${identity.author}#v${identity.version}`;
}

export function parseChartId(id: string): ChartIdentity | null {
  const parts = id.split('#');
  if (parts.length !== 3) return null;
  const [song, author, versionPart] = parts;
  if (!song || !author) return null;
  if (!/^v\d+$/.test(versionPart)) return null;
  const version = Number(versionPart.slice(1));
  if (!Number.isInteger(version) || version < 1) return null;
  return { songKey: song, author, version };
}

export interface StoredChart {
  chart: Chart;
  /** `<songKey>#<author>#v<n>`. The key this is stored under. */
  id: string;
  songKey: string;
  /** Slugged, and part of the id. */
  author: string;
  /** As typed, for display. `author` is what the id is built from. */
  authoredBy?: string;
  version: number;
  createdAtIso: string;
  savedAtIso: string;
  /**
   * When this was published to a server, if it ever was.
   *
   * Absent means the chart has never left this browser. Privacy here is the
   * absence of a copy rather than a flag asking a server to keep a secret —
   * the server cannot leak what it was never sent.
   */
  sharedAtIso?: string;
}

export interface ChartStore {
  get(id: string): Promise<StoredChart | null>;
  list(): Promise<StoredChart[]>;
  remove(id: string): Promise<void>;
  /** Store a chart that already has an identity — from a room, or a server. */
  save(stored: StoredChart): Promise<void>;
  /** Store a newly authored chart, taking the next version for this author. */
  add(chart: Chart, authoredBy?: string): Promise<StoredChart>;
}

/** The record a newly authored chart becomes, given the versions already held. */
export function nextRecord(
  chart: Chart,
  authoredBy: string | undefined,
  existing: readonly StoredChart[],
): StoredChart {
  const song = songKey(chart);
  const author = authorSlug(authoredBy);
  // Versions count per author, not per song: your v2 and their v1 are separate
  // readings of the same music, not a sequence.
  const mine = existing.filter((s) => s.songKey === song && s.author === author);
  const version = mine.reduce((highest, s) => Math.max(highest, s.version), 0) + 1;
  const nowIso = new Date().toISOString();
  return {
    chart,
    id: chartId({ songKey: song, author, version }),
    songKey: song,
    author,
    ...(authoredBy ? { authoredBy } : {}),
    version,
    createdAtIso: nowIso,
    savedAtIso: nowIso,
  };
}

/**
 * A record for a chart that ships with the game.
 *
 * Fixed timestamps, so it is identical in every browser and never jostles for
 * position in a list sorted by when things were saved.
 */
export function builtInRecord(chart: Chart): StoredChart {
  const song = songKey(chart);
  const epoch = '1970-01-01T00:00:00.000Z';
  return {
    chart,
    id: chartId({ songKey: song, author: 'built-in', version: 1 }),
    songKey: song,
    author: 'built-in',
    authoredBy: 'built in',
    version: 1,
    createdAtIso: epoch,
    savedAtIso: epoch,
  };
}

/**
 * A record for a chart that arrived from somewhere else.
 *
 * Always version 1 for that author, which makes storing it idempotent: the
 * room re-sends its chart on every pick, and each one must land on the same id
 * rather than piling up v2, v3, v4 for a song nobody re-tapped.
 *
 * A stopgap. Once charts carry their own identity across the wire, that
 * identity is what should be kept, and this becomes the fallback for charts
 * from an older build.
 */
export function receivedRecord(chart: Chart, authoredBy?: string): StoredChart {
  const song = songKey(chart);
  const author = authorSlug(authoredBy);
  const nowIso = new Date().toISOString();
  return {
    chart,
    id: chartId({ songKey: song, author, version: 1 }),
    songKey: song,
    author,
    ...(authoredBy ? { authoredBy } : {}),
    version: 1,
    createdAtIso: nowIso,
    savedAtIso: nowIso,
  };
}

function refuseInvalid(chart: Chart): void {
  const result = validateChart(chart);
  // Refusing to store an invalid chart keeps the problem at the point it was
  // created, rather than surfacing it as a broken song days later.
  if (!result.ok) {
    throw new Error(`Refusing to store an invalid chart:\n  ${result.errors.join('\n  ')}`);
  }
}

/**
 * Charts in this browser.
 *
 * Every read is validated rather than trusted. Stored data outlives the code
 * that wrote it — a chart saved by an older build, or edited by hand, must not
 * be able to crash a song by being merely plausible.
 */
export class LocalChartStore implements ChartStore {
  async get(id: string): Promise<StoredChart | null> {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + id);
      if (!raw) return null;
      return this.readRecord(raw);
    } catch {
      return null;
    }
  }

  async save(stored: StoredChart): Promise<void> {
    refuseInvalid(stored.chart);
    try {
      localStorage.setItem(STORAGE_PREFIX + stored.id, JSON.stringify(stored));
    } catch {
      // A full quota should not take a song down with it.
    }
  }

  async add(chart: Chart, authoredBy?: string): Promise<StoredChart> {
    refuseInvalid(chart);
    const stored = nextRecord(chart, authoredBy, await this.list());
    await this.save(stored);
    return stored;
  }

  async list(): Promise<StoredChart[]> {
    const charts: StoredChart[] = [];
    const legacy: StoredChart[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const id = key.slice(STORAGE_PREFIX.length);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const record = this.readRecord(raw);
      if (!record) continue;
      if (record.id === id) charts.push(record);
      else legacy.push(record);
    }

    // Rewrite anything stored under the old song-only key, then drop the old
    // entry. Done after the scan rather than during it, because mutating
    // localStorage while walking its indices skips entries.
    for (const record of legacy) {
      await this.save(record);
      localStorage.removeItem(STORAGE_PREFIX + record.songKey);
      charts.push(record);
    }

    return charts.sort((a, b) => b.savedAtIso.localeCompare(a.savedAtIso));
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(STORAGE_PREFIX + id);
  }

  /**
   * One stored entry, whatever era wrote it.
   *
   * Entries written before charts had versions are keyed by song alone and
   * carry no identity. They are read as v1 by whoever `authoredBy` says, which
   * is the only honest reading — and `list()` then rewrites them so the
   * upgrade happens once rather than on every read.
   */
  private readRecord(raw: string): StoredChart | null {
    let parsed: Partial<StoredChart> | null = null;
    try {
      parsed = JSON.parse(raw) as Partial<StoredChart>;
    } catch {
      return null;
    }
    if (!parsed?.chart || !validateChart(parsed.chart).ok) return null;

    const chart = parsed.chart;
    if (parsed.id && parseChartId(parsed.id)) return parsed as StoredChart;

    const song = songKey(chart);
    const author = authorSlug(parsed.authoredBy);
    const savedAtIso = parsed.savedAtIso ?? new Date().toISOString();
    return {
      chart,
      id: chartId({ songKey: song, author, version: 1 }),
      songKey: song,
      author,
      ...(parsed.authoredBy ? { authoredBy: parsed.authoredBy } : {}),
      version: 1,
      createdAtIso: parsed.createdAtIso ?? savedAtIso,
      savedAtIso,
    };
  }
}

/** In memory, for tests and for anything that should not touch a browser. */
export class MemoryChartStore implements ChartStore {
  private charts = new Map<string, StoredChart>();

  async get(id: string): Promise<StoredChart | null> {
    return this.charts.get(id) ?? null;
  }

  async save(stored: StoredChart): Promise<void> {
    refuseInvalid(stored.chart);
    this.charts.set(stored.id, stored);
  }

  async add(chart: Chart, authoredBy?: string): Promise<StoredChart> {
    refuseInvalid(chart);
    const stored = nextRecord(chart, authoredBy, [...this.charts.values()]);
    await this.save(stored);
    return stored;
  }

  async list(): Promise<StoredChart[]> {
    return [...this.charts.values()];
  }

  async remove(id: string): Promise<void> {
    this.charts.delete(id);
  }
}
