/**
 * Validation, shared by both sides.
 *
 * This file is the reason `packages/protocol` exists. Previously the client
 * validated in TypeScript and the server — plain JavaScript, so unable to
 * import it — validated separately or not at all. Two validators drift, and the
 * drift is invisible until something malformed reaches production.
 *
 * ## Two rules this file exists to hold
 *
 * **1. Every validator returns the validated VALUE, never just a verdict.**
 * A function that returns `{ ok: boolean }` forces its caller to write
 * `if (check(x).ok) { const c = x as Chart }` — the cast `ENGINEERING.md` §1
 * names as forbidden, made mandatory by the contract. And the cast lies,
 * because a boolean cannot express "valid, and here is the cleaned copy".
 *
 * **2. Messages are validated, not just charts.** The bug that motivated this
 * package was `PICK_SONG` — a message — and the first version of this file
 * validated chart revisions and nothing that crossed the wire. Every limit in
 * `limits.ts` existed and bounded nothing.
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
  type ChartRevision,
  type Note,
  type TimingMap,
} from './domain.ts';
import { asId, isRoomId, type BeatmapId, type RevisionId, type RoomId } from './ids.ts';
import {
  MAX_ARTIST_LENGTH,
  MAX_BPM,
  MAX_CHAT_LENGTH,
  MAX_COMBO,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_NOTES,
  MAX_NOTE_ID_LENGTH,
  MAX_NOTE_TIME_MS,
  MAX_PLAUSIBLE_SCORE,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TIMING_POINTS,
  MAX_TITLE_LENGTH,
  MIN_BPM,
} from './limits.ts';
import { MEDIA_FAILURES, type ClientMessage } from './messages.ts';
import type { PlayerProgress, RoundResult } from './judgments.ts';
import { JUDGMENTS } from './judgments.ts';

/**
 * A verdict that carries the thing it approved.
 *
 * `value` is built from checked fields rather than aliased to the input, so an
 * unknown key in the payload cannot ride along into storage or into another
 * player's browser.
 */
export type Validated<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[] };

const fail = (...errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });
const pass = <T>(value: T, warnings: string[] = []) => ({ ok: true as const, value, warnings });

const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
/** Integers only, and only ones that survive a round trip through JSON. */
const isSafeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A number in range, rejecting `NaN`, `Infinity` and the `-0` foot-gun. */
const inRange = (v: unknown, min: number, max: number): v is number =>
  isFiniteNumber(v) && Object.is(v, -0) === false && v >= min && v <= max;

// ------------------------------------------------------------------ text ----

/**
 * Characters with no business in anything a person reads.
 *
 * C0 and DEL are the obvious ones. The rest sit above `0x20`, so a naive
 * "is it a control character" test lets every one of them through:
 *
 * - **C1 (0x80–0x9f)**, which terminals still act on.
 * - **Bidi controls.** One U+202E reverses the rendering of everything after
 *   it, so a title can make the rest of a line read as something its author
 *   never wrote. U+061C is one of these and sits on its own, outside both of
 *   the ranges people usually remember.
 * - **Line and paragraph separators** (U+2028/9), which break log lines and
 *   JavaScript string literals.
 * - **Characters that render as nothing.** Zero-width spaces and joiners, the
 *   soft hyphen, and — the ones that get missed — U+3164 HANGUL FILLER and
 *   U+2800 BRAILLE PATTERN BLANK. A title of `'ㅤㅤㅤ'` is invisible and would
 *   otherwise pass a "must contain something readable" check as readable.
 */
export function isHostileChar(code: number): boolean {
  return (
    code < 0x20 ||
    code === 0x7f ||
    (code >= 0x80 && code <= 0x9f) ||
    code === 0xad ||
    code === 0x61c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x2800 ||
    code === 0x3164 ||
    code === 0xfeff
  );
}

/**
 * Strip hostile characters, trim, and bound — or reject.
 *
 * Returns null for anything that is not a string. It used to begin
 * `String(value ?? '')`, which coerced rather than rejected: `{}` became
 * `"[object Object]"` and `['evil']` became `"evil"`, and both were then
 * accepted as titles.
 *
 * The truncation slices the **codepoint array**, not the joined string. Slicing
 * the string is UTF-16-unit work and cuts surrogate pairs in half, producing a
 * lone surrogate — a string that cannot be encoded as UTF-8, that Postgres
 * refuses, and that a strict JSON parser rejects. A comment claiming
 * codepoint-awareness is not codepoint-awareness.
 */
export function sanitiseText(value: unknown, limit: number): string | null {
  if (!isString(value)) return null;
  return [...value]
    .filter((ch) => !isHostileChar(ch.codePointAt(0) ?? 0))
    .slice(0, limit)
    .join('')
    .trim();
}

/** Sanitise, and require something readable to be left. */
function requireText(value: unknown, limit: number, field: string, errors: string[]): string | null {
  const text = sanitiseText(value, limit);
  if (text === null) {
    errors.push(`\`${field}\` must be a string.`);
    return null;
  }
  if (text.length === 0) {
    errors.push(`\`${field}\` must contain something readable.`);
    return null;
  }
  return text;
}

// ----------------------------------------------------------------- notes ----

function validateNote(
  input: unknown,
  index: number,
  errors: string[],
  seen: Set<string>,
): Note | null {
  const where = `note[${index}]`;
  if (!isPlainObject(input)) {
    errors.push(`${where} is not an object.`);
    return null;
  }

  const id = sanitiseText(input.id, MAX_NOTE_ID_LENGTH);
  if (id === null || id.length === 0) {
    // Bounded and cleaned because it is the one identifier in the model with no
    // shape rule of its own — and because two ids differing only by an
    // invisible character would otherwise pass as distinct notes.
    errors.push(`${where} needs a readable id of at most ${MAX_NOTE_ID_LENGTH} characters.`);
    return null;
  }
  if (seen.has(id)) {
    errors.push(`${where} has a duplicate id "${id}".`);
    return null;
  }
  seen.add(id);

  if (!LANES.includes(input.lane as never)) {
    errors.push(`${where} has unknown lane "${String(input.lane)}".`);
    return null;
  }
  const lane = input.lane as Note['lane'];

  if (!inRange(input.timeMs, 0, MAX_NOTE_TIME_MS)) {
    errors.push(`${where} needs a timeMs between 0 and ${MAX_NOTE_TIME_MS}.`);
    return null;
  }
  const timeMs = input.timeMs as number;

  if (input.type === 'tap') {
    if (input.durationMs !== undefined) {
      errors.push(`${where} is a tap and must not carry a durationMs.`);
      return null;
    }
    return { id, timeMs, lane, type: 'tap' };
  }

  if (input.type === 'hold') {
    if (!inRange(input.durationMs, 1, MAX_NOTE_TIME_MS)) {
      errors.push(`${where} is a hold and needs a positive durationMs.`);
      return null;
    }
    const durationMs = input.durationMs as number;
    if (timeMs + durationMs > MAX_NOTE_TIME_MS) {
      errors.push(`${where} holds past any plausible song length.`);
      return null;
    }
    return { id, timeMs, lane, type: 'hold', durationMs };
  }

  errors.push(`${where} has unknown type "${String(input.type)}".`);
  return null;
}

// ---------------------------------------------------------------- timing ----

export function validateTiming(input: unknown, errors: string[]): TimingMap | null {
  if (!Array.isArray(input)) {
    errors.push('`timing` must be an array of timing points.');
    return null;
  }
  if (input.length === 0) {
    errors.push('`timing` needs at least one point.');
    return null;
  }
  if (input.length > MAX_TIMING_POINTS) {
    errors.push(`\`timing\` has more than ${MAX_TIMING_POINTS} points.`);
    return null;
  }

  const points: { timeMs: number; bpm: number; beat: number }[] = [];
  let previousTime = -Infinity;
  let previousBeat = -Infinity;

  for (const [index, raw] of input.entries()) {
    const where = `timing[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} is not an object.`);
      return null;
    }
    if (!inRange(raw.timeMs, 0, MAX_NOTE_TIME_MS)) {
      errors.push(`${where} needs a timeMs between 0 and ${MAX_NOTE_TIME_MS}.`);
      return null;
    }
    // Strictly increasing, not merely non-decreasing: two points at the same
    // instant give the map two answers for one moment.
    if ((raw.timeMs as number) <= previousTime) {
      errors.push(`${where} is at or before the point before it.`);
      return null;
    }
    if (!inRange(raw.bpm, MIN_BPM, MAX_BPM)) {
      errors.push(`${where} needs a bpm between ${MIN_BPM} and ${MAX_BPM}.`);
      return null;
    }
    if (!isSafeInt(raw.beat) || (raw.beat as number) < 0) {
      errors.push(`${where} needs a beat that is a whole number, zero or more.`);
      return null;
    }
    // Beats run forward with time. A later anchor exists to re-align a drifting
    // recording, which it cannot do if it is allowed to point backwards.
    if ((raw.beat as number) < previousBeat) {
      errors.push(`${where} has a beat before the point that precedes it.`);
      return null;
    }
    previousTime = raw.timeMs as number;
    previousBeat = raw.beat as number;
    points.push({ timeMs: raw.timeMs as number, bpm: raw.bpm as number, beat: raw.beat as number });
  }

  return points;
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
export function validateChartRevision(input: unknown): Validated<ChartRevision> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(input)) return fail('A chart revision must be an object.');

  const id = asId<RevisionId>(input.id);
  const beatmapId = asId<BeatmapId>(input.beatmapId);
  if (!id) errors.push('`id` must be a uuid.');
  if (!beatmapId) errors.push('`beatmapId` must be a uuid.');

  if (input.schemaVersion !== CHART_SCHEMA_VERSION) {
    errors.push(
      `Unsupported schemaVersion ${String(input.schemaVersion)} — this build reads ${CHART_SCHEMA_VERSION}.`,
    );
  }
  if (!isSafeInt(input.revision) || (input.revision as number) < 1) {
    errors.push('`revision` must be a positive whole number.');
  }
  if (!isString(input.createdAtIso) || Number.isNaN(Date.parse(input.createdAtIso))) {
    errors.push('`createdAtIso` must be a date.');
  }
  if (input.generatorVersion !== undefined && !isString(input.generatorVersion)) {
    errors.push('`generatorVersion`, if present, must be a string.');
  }
  if (input.generatorSeed !== undefined && !isSafeInt(input.generatorSeed)) {
    errors.push('`generatorSeed`, if present, must be a whole number.');
  }

  const timing = validateTiming(input.timing, errors);

  if (!Array.isArray(input.notes)) {
    errors.push('`notes` must be an array.');
    return fail(...errors);
  }
  if (input.notes.length > MAX_NOTES) {
    return fail(...errors, `A chart of ${input.notes.length} notes is implausibly long.`);
  }

  const seen = new Set<string>();
  const notes: Note[] = [];
  let previousTime = -Infinity;
  for (const [index, raw] of input.notes.entries()) {
    const note = validateNote(raw, index, errors, seen);
    if (!note) continue;
    // Sorted order is not cosmetic: the engine walks forward and never looks
    // back at a note it has passed.
    if (note.timeMs < previousTime) errors.push(`note[${index}] is out of order.`);
    previousTime = note.timeMs;
    notes.push(note);
  }

  if (errors.length > 0 || !timing || !id || !beatmapId) return fail(...errors);
  if (notes.length === 0) warnings.push('This chart has no notes.');

  return pass<ChartRevision>(
    {
      id,
      beatmapId,
      schemaVersion: CHART_SCHEMA_VERSION,
      revision: input.revision as number,
      timing,
      notes,
      ...(isString(input.generatorVersion) ? { generatorVersion: input.generatorVersion } : {}),
      ...(isSafeInt(input.generatorSeed) ? { generatorSeed: input.generatorSeed } : {}),
      createdAtIso: input.createdAtIso as string,
    },
    warnings,
  );
}

// -------------------------------------------------------------- metadata ----

export interface BeatmapMetadata {
  title?: string;
  difficulty: (typeof DIFFICULTIES)[number];
  status: (typeof BEATMAP_STATUSES)[number];
  tags: string[];
}

export function validateBeatmapMetadata(input: unknown): Validated<BeatmapMetadata> {
  const errors: string[] = [];
  if (!isPlainObject(input)) return fail('Beatmap metadata must be an object.');

  if (!DIFFICULTIES.includes(input.difficulty as never)) {
    errors.push(`Unknown difficulty "${String(input.difficulty)}".`);
  }
  if (!BEATMAP_STATUSES.includes(input.status as never)) {
    errors.push(`Unknown status "${String(input.status)}".`);
  }

  let title: string | undefined;
  if (input.title !== undefined) {
    // The sanitised value is what comes back. Sanitising only to test for
    // emptiness and then discarding the result let a 100,000-character title
    // through: the check passed, and the caller kept the original.
    const cleaned = requireText(input.title, MAX_TITLE_LENGTH, 'title', errors);
    if (cleaned) title = cleaned;
  }

  const tags: string[] = [];
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) errors.push('`tags` must be an array.');
    else if (input.tags.length > MAX_TAGS) errors.push(`No more than ${MAX_TAGS} tags.`);
    else {
      for (const raw of input.tags) {
        const tag = sanitiseText(raw, MAX_TAG_LENGTH);
        if (tag === null || tag.length === 0) {
          errors.push('Every tag must be readable text.');
          break;
        }
        // Lowercased and de-duplicated, so `Rock` and `rock` are one tag rather
        // than two rows in the catalogue.
        const normalised = tag.toLowerCase();
        if (!tags.includes(normalised)) tags.push(normalised);
      }
    }
  }

  if (errors.length > 0) return fail(...errors);
  return pass<BeatmapMetadata>({
    ...(title ? { title } : {}),
    difficulty: input.difficulty as BeatmapMetadata['difficulty'],
    status: input.status as BeatmapMetadata['status'],
    tags,
  });
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

// -------------------------------------------------------------- progress ----

export function validateProgress(input: unknown): Validated<PlayerProgress> {
  if (!isPlainObject(input)) return fail('Progress must be an object.');
  if (!inRange(input.score, 0, MAX_PLAUSIBLE_SCORE)) return fail('Implausible score.');
  if (!inRange(input.combo, 0, MAX_COMBO)) return fail('Implausible combo.');
  if (!inRange(input.accuracy, 0, 1)) return fail('Accuracy must be between 0 and 1.');
  if (!inRange(input.health, 0, 100)) return fail('Health must be between 0 and 100.');
  return pass<PlayerProgress>({
    score: input.score as number,
    combo: input.combo as number,
    accuracy: input.accuracy as number,
    health: input.health as number,
  });
}

export function validateRoundResult(input: unknown): Validated<RoundResult> {
  const progress = validateProgress(input);
  if (!progress.ok) return progress;
  const raw = input as Record<string, unknown>;

  if (!inRange(raw.maxCombo, 0, MAX_COMBO)) return fail('Implausible max combo.');
  if (!isBoolean(raw.completed)) return fail('`completed` must be a boolean.');
  if (!isPlainObject(raw.counts)) return fail('`counts` must be an object.');

  const counts = {} as Record<(typeof JUDGMENTS)[number], number>;
  for (const judgment of JUDGMENTS) {
    const n = raw.counts[judgment];
    if (!isSafeInt(n) || (n as number) < 0) return fail(`\`counts.${judgment}\` must be a count.`);
    counts[judgment] = n as number;
  }

  return pass<RoundResult>({
    ...progress.value,
    maxCombo: raw.maxCombo as number,
    counts,
    completed: raw.completed,
  });
}

// --------------------------------------------------------------- messages ----

/**
 * One message off the wire, or nothing.
 *
 * The only sanctioned way to read a `ClientMessage`. It returns a value built
 * field by field, so an unknown key cannot ride along — and every string is
 * bounded here rather than wherever it happens to be rendered.
 *
 * A malformed message is refused, never repaired. Guessing what someone meant
 * is how a validator becomes an attack surface.
 */
export function parseClientMessage(input: unknown): Validated<ClientMessage> {
  if (!isPlainObject(input)) return fail('A message must be an object.');
  if (!isString(input.type)) return fail('A message needs a type.');

  switch (input.type) {
    case 'join': {
      if (!isRoomId(input.roomId)) return fail('That room name cannot be used.');
      return pass<ClientMessage>({ type: 'join', roomId: input.roomId as RoomId });
    }

    case 'leave':
      return pass<ClientMessage>({ type: 'leave' });

    case 'chat': {
      const errors: string[] = [];
      const text = requireText(input.text, MAX_CHAT_LENGTH, 'text', errors);
      if (!text) return fail(...errors);
      return pass<ClientMessage>({ type: 'chat', text });
    }

    case 'queueAdd': {
      const beatmapId = asId<BeatmapId>(input.beatmapId);
      if (!beatmapId) return fail('`beatmapId` must be a uuid.');
      return pass<ClientMessage>({ type: 'queueAdd', beatmapId });
    }

    case 'queueRemove': {
      const queueItemId = asId(input.queueItemId);
      if (!queueItemId) return fail('`queueItemId` must be a uuid.');
      return pass<ClientMessage>({ type: 'queueRemove', queueItemId });
    }

    case 'ready': {
      if (!isBoolean(input.ready)) return fail('`ready` must be true or false.');
      return pass<ClientMessage>({ type: 'ready', ready: input.ready });
    }

    case 'mediaResult': {
      const revisionId = asId<RevisionId>(input.revisionId);
      if (!revisionId) return fail('`revisionId` must be a uuid.');
      if (!isBoolean(input.ok)) return fail('`ok` must be true or false.');
      // A code from a closed set, never a sentence — the server owns the
      // wording of anything that reaches a room as an announcement.
      const reason = MEDIA_FAILURES.includes(input.reason as never)
        ? (input.reason as ClientMessage extends { reason?: infer R } ? R : never)
        : undefined;
      return pass<ClientMessage>({
        type: 'mediaResult',
        revisionId,
        ok: input.ok,
        ...(input.ok ? {} : { reason: reason ?? 'unknown' }),
      });
    }

    case 'progress': {
      const progress = validateProgress(input.progress);
      if (!progress.ok) return fail(...progress.errors);
      return pass<ClientMessage>({ type: 'progress', progress: progress.value });
    }

    case 'finish': {
      const result = validateRoundResult(input.result);
      if (!result.ok) return fail(...result.errors);
      return pass<ClientMessage>({ type: 'finish', result: result.value });
    }

    default:
      return fail(`Unknown message type "${input.type}".`);
  }
}

/** A display name, as the server will show it to everyone else. */
export function cleanDisplayName(value: unknown): string {
  return sanitiseText(value, MAX_DISPLAY_NAME_LENGTH) || 'neko';
}
