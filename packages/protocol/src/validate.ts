/**
 * Validation, shared by both sides.
 *
 * This file is the reason `packages/protocol` exists. Previously the client
 * validated in TypeScript and the server — plain JavaScript, so unable to
 * import it — validated separately or not at all. Two validators drift, and the
 * drift is invisible until something malformed reaches production.
 *
 * One function, imported by `apps/web` and `apps/server` alike. If they
 * disagree it is because someone changed this file, which is a diff.
 *
 * Written by hand rather than with a schema library: it is the single most
 * security-relevant code in the repository, the rules are specific enough that
 * a generic validator would need as much configuration as this is code, and it
 * adds no dependency to a package both sides import.
 */
import {
  BEATMAP_STATUSES,
  CHART_SCHEMA_VERSION,
  DIFFICULTIES,
  LANES,
  NOTE_TYPES,
  type ChartRevision,
  type Note,
  type TimingMap,
  type TimingPoint,
} from './domain.ts';
import {
  MAX_ARTIST_LENGTH,
  MAX_BPM,
  MAX_NOTES,
  MAX_NOTE_TIME_MS,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TIMING_POINTS,
  MAX_TITLE_LENGTH,
  MIN_BPM,
} from './limits.ts';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';

/**
 * Characters with no business in anything a person reads.
 *
 * C0 and DEL are the obvious ones. The rest sit above `0x20`, so a naive
 * "is it a control character" test lets every one of them through:
 *
 * - **C1 (0x80–0x9f)**, which terminals still act on.
 * - **Bidi overrides and isolates.** One U+202E reverses the rendering of
 *   everything after it, so a title can make the rest of a line read as
 *   something its author never wrote.
 * - **Zero-width characters.** Invisible, so two identical-looking titles are
 *   different strings and a length cap fills with padding nobody can see.
 */
export function isHostileChar(code: number): boolean {
  return (
    code < 0x20 ||
    code === 0x7f ||
    (code >= 0x80 && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** Strip hostile characters, trim, and bound. Codepoint-aware, not UTF-16-unit. */
export function sanitiseText(value: unknown, limit: number): string {
  return [...String(value ?? '')]
    .filter((ch) => !isHostileChar(ch.codePointAt(0) ?? 0))
    .join('')
    .trim()
    .slice(0, limit);
}

// ----------------------------------------------------------------- notes ----

function validateNote(note: unknown, index: number, errors: string[], seen: Set<string>): number | null {
  const where = `note[${index}]`;
  if (typeof note !== 'object' || note === null) {
    errors.push(`${where} is not an object.`);
    return null;
  }
  const n = note as Partial<Note>;

  if (!isString(n.id) || n.id.length === 0) errors.push(`${where} is missing an id.`);
  else if (seen.has(n.id)) errors.push(`${where} has a duplicate id "${n.id}".`);
  else seen.add(n.id);

  if (!LANES.includes(n.lane as never)) errors.push(`${where} has unknown lane "${String(n.lane)}".`);
  if (!NOTE_TYPES.includes(n.type as never)) errors.push(`${where} has unknown type "${String(n.type)}".`);

  if (!isFiniteNumber(n.timeMs) || n.timeMs < 0) {
    errors.push(`${where} needs a timeMs of zero or more.`);
    return null;
  }
  if (n.timeMs > MAX_NOTE_TIME_MS) {
    errors.push(`${where} is beyond any plausible song length.`);
    return null;
  }

  if (n.type === 'hold') {
    if (!isFiniteNumber(n.durationMs) || n.durationMs <= 0) {
      errors.push(`${where} is a hold and needs a positive durationMs.`);
    } else if (n.timeMs + n.durationMs > MAX_NOTE_TIME_MS) {
      errors.push(`${where} holds past any plausible song length.`);
    }
  } else if (n.durationMs !== undefined) {
    errors.push(`${where} is a tap and must not carry a durationMs.`);
  }

  return n.timeMs;
}

// ---------------------------------------------------------------- timing ----

export function validateTiming(timing: unknown, errors: string[]): void {
  if (!Array.isArray(timing)) {
    errors.push('`timing` must be an array of timing points.');
    return;
  }
  if (timing.length === 0) {
    errors.push('`timing` needs at least one point.');
    return;
  }
  if (timing.length > MAX_TIMING_POINTS) {
    errors.push(`\`timing\` has more than ${MAX_TIMING_POINTS} points.`);
    return;
  }

  let previousTime = -Infinity;
  (timing as TimingMap).forEach((point: TimingPoint, index) => {
    const where = `timing[${index}]`;
    if (typeof point !== 'object' || point === null) {
      errors.push(`${where} is not an object.`);
      return;
    }
    if (!isFiniteNumber(point.timeMs) || point.timeMs < 0) {
      errors.push(`${where} needs a timeMs of zero or more.`);
    } else {
      // Ordered, because anything reading the map walks it forward and never
      // looks back at a point it has passed.
      if (point.timeMs < previousTime) errors.push(`${where} is out of order.`);
      previousTime = point.timeMs;
    }
    if (!isFiniteNumber(point.bpm) || point.bpm < MIN_BPM || point.bpm > MAX_BPM) {
      errors.push(`${where} needs a bpm between ${MIN_BPM} and ${MAX_BPM}.`);
    }
    if (!isFiniteNumber(point.beat) || point.beat < 0) {
      errors.push(`${where} needs a beat of zero or more.`);
    }
  });
}

// -------------------------------------------------------------- revision ----

/**
 * A chart revision, checked hard enough to store and to play.
 *
 * Everything crossing a trust boundary goes through this: an upload, a chart
 * read back from the database, a revision fetched by a client. Stored data
 * outlives the code that wrote it, so "we validated it on the way in" is not a
 * reason to skip validating it on the way out.
 */
export function validateChartRevision(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['A chart revision must be an object.'], warnings };
  }
  const revision = input as Partial<ChartRevision>;

  if (revision.schemaVersion !== CHART_SCHEMA_VERSION) {
    errors.push(
      `Unsupported schemaVersion ${String(revision.schemaVersion)} — this build reads ${CHART_SCHEMA_VERSION}.`,
    );
  }
  if (!isFiniteNumber(revision.revision) || revision.revision < 1) {
    errors.push('`revision` must be a positive integer.');
  }

  validateTiming(revision.timing, errors);

  if (!Array.isArray(revision.notes)) {
    errors.push('`notes` must be an array.');
    return { ok: errors.length === 0, errors, warnings };
  }
  if (revision.notes.length > MAX_NOTES) {
    errors.push(`A chart of ${revision.notes.length} notes is implausibly long.`);
    return { ok: false, errors, warnings };
  }

  const seen = new Set<string>();
  let previousTime = -Infinity;
  revision.notes.forEach((note, index) => {
    const timeMs = validateNote(note, index, errors, seen);
    if (timeMs === null) return;
    // Sorted order is not cosmetic: the engine walks forward and never looks
    // back at a note it has passed.
    if (timeMs < previousTime) errors.push(`note[${index}] is out of order.`);
    previousTime = timeMs;
  });

  if (revision.notes.length === 0) warnings.push('This chart has no notes.');

  return { ok: errors.length === 0, errors, warnings };
}

// -------------------------------------------------------------- metadata ----

export function validateBeatmapMetadata(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['Beatmap metadata must be an object.'], warnings };
  }
  const beatmap = input as { difficulty?: unknown; status?: unknown; tags?: unknown; title?: unknown };

  if (!DIFFICULTIES.includes(beatmap.difficulty as never)) {
    errors.push(`Unknown difficulty "${String(beatmap.difficulty)}".`);
  }
  if (!BEATMAP_STATUSES.includes(beatmap.status as never)) {
    errors.push(`Unknown status "${String(beatmap.status)}".`);
  }
  if (beatmap.title !== undefined && sanitiseText(beatmap.title, MAX_TITLE_LENGTH).length === 0) {
    errors.push('A title, if given, must contain something readable.');
  }
  if (beatmap.tags !== undefined) {
    if (!Array.isArray(beatmap.tags)) errors.push('`tags` must be an array.');
    else if (beatmap.tags.length > MAX_TAGS) errors.push(`No more than ${MAX_TAGS} tags.`);
    else if (beatmap.tags.some((t) => !isString(t) || sanitiseText(t, MAX_TAG_LENGTH).length === 0)) {
      errors.push('Every tag must be readable text.');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Clean a song's own metadata down to what is safe to display and store. */
export function cleanSongMetadata(input: { title?: unknown; artist?: unknown }): {
  title: string;
  artist: string;
} {
  return {
    title: sanitiseText(input.title, MAX_TITLE_LENGTH) || 'Untitled',
    artist: sanitiseText(input.artist, MAX_ARTIST_LENGTH) || 'Unknown',
  };
}
