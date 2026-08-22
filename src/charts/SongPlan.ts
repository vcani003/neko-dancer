/**
 * A song's shape: where it starts, where it is empty, and where it gets busy.
 *
 * A tempo grid alone treats a song as uniform, which no song is. An intro is
 * often silence or atmosphere with no beat worth hitting; a breakdown wants
 * fewer arrows rather than the same arrows more quietly; a final chorus can
 * take more than the first verse. Placing arrows evenly across all of it makes
 * a chart that is technically on the beat and musically deaf.
 *
 * So a plan is a grid plus SECTIONS, and a section carries its own rules.
 *
 * The plan is pure data and every function here is pure. It can be inferred
 * from tapping, edited by hand, stored, and diffed — and none of that requires
 * audio, which matters because for a YouTube song there is none to be had.
 */

export type SectionKind =
  /** Arrows are placed here. */
  | 'play'
  /** No arrows at all: an intro, an outro, a silent passage. */
  | 'skip';

export interface Section {
  id: string;
  startMs: number;
  /** Exclusive. The last section may run to the end of the song. */
  endMs: number;
  kind: SectionKind;
  /**
   * How busy this section should be, relative to the chart's base density.
   * 1 is normal, below 1 is sparser, above 1 is denser. Ignored when skipped.
   */
  intensity: number;
  /** Tempo just for this section, when a song changes pace partway. */
  bpm?: number;
  label?: string;
}

export interface SongPlan {
  /** Milliseconds to the first beat of the grid. */
  firstBeatMs: number;
  bpm: number;
  durationMs: number;
  sections: Section[];
}

/** A plan with no structure: the whole song, played evenly. */
export function flatPlan(bpm: number, firstBeatMs: number, durationMs: number): SongPlan {
  return {
    bpm,
    firstBeatMs,
    durationMs,
    sections: [
      {
        id: 's1',
        startMs: 0,
        endMs: durationMs,
        kind: 'play',
        intensity: 1,
      },
    ],
  };
}

/** The section covering a moment, or null if none does. */
export function sectionAt(plan: SongPlan, timeMs: number): Section | null {
  return plan.sections.find((s) => timeMs >= s.startMs && timeMs < s.endMs) ?? null;
}

/** The tempo in force at a moment: the section's, or the song's. */
export function bpmAt(plan: SongPlan, timeMs: number): number {
  return sectionAt(plan, timeMs)?.bpm ?? plan.bpm;
}

/** Whether arrows belong at a moment. Outside every section counts as skip. */
export function playsAt(plan: SongPlan, timeMs: number): boolean {
  return sectionAt(plan, timeMs)?.kind === 'play';
}

export function intensityAt(plan: SongPlan, timeMs: number): number {
  const section = sectionAt(plan, timeMs);
  return section && section.kind === 'play' ? section.intensity : 0;
}

export interface PlanProblem {
  message: string;
  sectionId?: string;
}

/**
 * Check a plan holds together.
 *
 * Overlapping sections would make `sectionAt` depend on array order, which is
 * the kind of bug that shows up as "sometimes the arrows stop" months later.
 */
export function validatePlan(plan: SongPlan): PlanProblem[] {
  const problems: PlanProblem[] = [];

  if (!(plan.bpm > 0)) problems.push({ message: 'Tempo must be above zero.' });
  if (!(plan.durationMs > 0)) problems.push({ message: 'Duration must be above zero.' });

  const sorted = [...plan.sections].sort((a, b) => a.startMs - b.startMs);
  const seen = new Set<string>();

  for (const section of sorted) {
    if (seen.has(section.id)) {
      problems.push({ message: 'Duplicate section id.', sectionId: section.id });
    }
    seen.add(section.id);

    if (section.endMs <= section.startMs) {
      problems.push({ message: 'Section ends before it starts.', sectionId: section.id });
    }
    if (section.startMs < 0) {
      problems.push({ message: 'Section starts before the song.', sectionId: section.id });
    }
    if (section.intensity < 0 || section.intensity > 4) {
      problems.push({ message: 'Intensity should be between 0 and 4.', sectionId: section.id });
    }
    if (section.bpm !== undefined && !(section.bpm > 0)) {
      problems.push({ message: 'Section tempo must be above zero.', sectionId: section.id });
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMs < sorted[i - 1].endMs) {
      problems.push({ message: 'Sections overlap.', sectionId: sorted[i].id });
    }
  }

  return problems;
}

/** Keep sections ordered and non-overlapping after an edit. */
export function normalisePlan(plan: SongPlan): SongPlan {
  const sorted = [...plan.sections].sort((a, b) => a.startMs - b.startMs);
  const sections: Section[] = [];

  for (const section of sorted) {
    const previous = sections[sections.length - 1];
    // Trim rather than drop: an edit that nudged one section into another
    // meant to move the boundary, not to delete anything.
    const startMs = previous ? Math.max(section.startMs, previous.endMs) : Math.max(0, section.startMs);
    const endMs = Math.min(section.endMs, plan.durationMs);
    if (endMs <= startMs) continue;
    sections.push({ ...section, startMs, endMs });
  }

  return { ...plan, sections };
}

// ---------------------------------------------------------------------------
// Inferring a plan from tapping
// ---------------------------------------------------------------------------

export interface InferOptions {
  /** A gap this many beats long is a passage with nothing worth hitting. */
  skipGapBeats?: number;
  /** Shortest section worth keeping, in beats. Shorter ones get merged. */
  minSectionBeats?: number;
}

/**
 * Read a song's shape out of how someone tapped along to it.
 *
 * The insight is that tapping already contains the structure, and throwing it
 * away to keep only the average tempo discards most of what was expressed:
 *
 *   WHERE THEY STOPPED  is a passage with nothing worth hitting. The silence
 *     before the first tap is the intro — which is exactly the "skip the empty
 *     bit" problem, solved by noticing nobody tapped there.
 *
 *   HOW FAST THEY TAPPED is how busy that passage felt. Someone doubling up
 *     through a chorus is saying the chorus should be denser, and they are
 *     more likely to be right than a detector would be.
 *
 * @param taps tap times in song milliseconds.
 */
export function inferPlanFromTaps(
  taps: readonly number[],
  bpm: number,
  firstBeatMs: number,
  durationMs: number,
  options: InferOptions = {},
): SongPlan {
  const beatMs = 60_000 / bpm;
  const skipGapMs = (options.skipGapBeats ?? 4) * beatMs;
  const minSectionMs = (options.minSectionBeats ?? 4) * beatMs;

  const sorted = [...taps].sort((a, b) => a - b);
  if (sorted.length === 0) return flatPlan(bpm, firstBeatMs, durationMs);

  // Split the taps into runs, breaking wherever they stopped for a while.
  const runs: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > skipGapMs) runs.push([sorted[i]]);
    else runs[runs.length - 1].push(sorted[i]);
  }

  // Density is judged relative to the whole performance, so "busier" means
  // busier than this person's own baseline rather than an absolute rate.
  const rates = runs
    .filter((run) => run.length > 1)
    .map((run) => (run.length - 1) / ((run[run.length - 1] - run[0]) / beatMs));
  const baseline = rates.length > 0 ? median(rates) : 1;

  const sections: Section[] = [];
  let cursor = 0;
  let index = 0;

  const push = (startMs: number, endMs: number, kind: SectionKind, intensity: number, label?: string) => {
    if (endMs - startMs <= 0) return;
    sections.push({
      id: `s${++index}`,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      kind,
      intensity: Number(intensity.toFixed(2)),
      ...(label ? { label } : {}),
    });
  };

  for (const run of runs) {
    const runStart = run[0];
    const runEnd = run.length > 1 ? run[run.length - 1] : run[0] + beatMs;

    // Anything before this run that nobody tapped through.
    if (runStart - cursor > minSectionMs) {
      push(cursor, runStart, 'skip', 0, cursor === 0 ? 'intro' : 'break');
    }

    const rate =
      run.length > 1 ? (run.length - 1) / ((runEnd - runStart) / beatMs) : baseline;
    push(Math.max(cursor, runStart), runEnd, 'play', clamp(rate / baseline, 0.25, 3));
    cursor = runEnd;
  }

  if (durationMs - cursor > minSectionMs) push(cursor, durationMs, 'skip', 0, 'outro');

  return normalisePlan({ bpm, firstBeatMs, durationMs, sections });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
