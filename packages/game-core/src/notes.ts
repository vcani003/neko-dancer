/**
 * The bookkeeping that turns a chart's notes into a run.
 *
 * A `ChartRevision` is immutable and shared; a run needs somewhere to record
 * what happened to each note. That is all this is — the chart's notes, each
 * paired with the state the engine accumulates against it.
 *
 * **Note times are absolute.** ADR-003: nothing here adds a chart offset, and
 * the revision's timing map never reaches this file. The previous build kept a
 * separate `ActiveArrow.timeMs` because `Arrow.timeMs` meant "relative to the
 * grid" — one name with two meanings, waiting to be confused. There is now one
 * number, and it lives on the note.
 */
import type { HoldNote, Judgment, JudgmentWindows, Lane, Note } from '@neko/protocol';

/** One note's state within a run, as anything outside the engine may read it. */
export interface ActiveNote {
  readonly note: Note;
  /** What the press was worth, or null while the note is still unjudged. */
  readonly judgment: Judgment | null;
  /** Signed error: negative early, positive late. Null until judged. */
  readonly deltaMs: number | null;
  /** Holds only: true while the key is down and the sustain is still running. */
  readonly holding: boolean;
  /** Holds only: 0–1 of the sustain credited, once it has been settled. */
  readonly heldFraction: number | null;
}

/**
 * The same thing, writable, and only inside this package.
 *
 * A separate mutable type rather than casting away `readonly`: the engine
 * mutates these in place sixty times a second and allocating a fresh object per
 * note per frame is exactly the kind of thing that shows up as a stutter.
 */
export interface TrackedNote {
  note: Note;
  judgment: Judgment | null;
  deltaMs: number | null;
  holding: boolean;
  heldFraction: number | null;
  /** True once nothing further can happen to this note. */
  settled: boolean;
}

export function trackNotes(notes: readonly Note[]): TrackedNote[] {
  return notes.map((note) => ({
    note,
    judgment: null,
    deltaMs: null,
    holding: false,
    heldFraction: null,
    settled: false,
  }));
}

/** When a note stops being the player's problem: its tail, or its own instant. */
export function noteEndMs(note: Note): number {
  return note.type === 'hold' ? note.timeMs + note.durationMs : note.timeMs;
}

export function isHold(note: Note): note is HoldNote {
  return note.type === 'hold';
}

/**
 * The note a press should be credited against: nearest in time, in that lane,
 * still unjudged, still inside the widest window.
 *
 * Nearest rather than earliest matters when two notes sit close together in one
 * lane — crediting the earlier one consumes the note the player was not aiming
 * at and leaves the intended one to expire.
 *
 * `fromIndex` is the engine's cursor. Scanning starts there and stops as soon
 * as the notes are further away than the widest window can reach, which is what
 * makes this cheap on a long chart: notes are ordered, so everything before the
 * cursor is settled and everything past the bound is out of reach.
 */
export function findClaimable(
  tracked: readonly TrackedNote[],
  fromIndex: number,
  lane: Lane,
  atMs: number,
  windows: JudgmentWindows,
): TrackedNote | null {
  let best: TrackedNote | null = null;
  let bestDelta = Infinity;

  for (let i = fromIndex; i < tracked.length; i++) {
    const active = tracked[i];
    if (!active) break;
    if (active.note.timeMs > atMs + windows.okayMs) break;
    if (active.judgment !== null) continue;
    if (active.note.lane !== lane) continue;

    const delta = Math.abs(atMs - active.note.timeMs);
    if (delta > windows.okayMs) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = active;
    }
  }

  return best;
}
