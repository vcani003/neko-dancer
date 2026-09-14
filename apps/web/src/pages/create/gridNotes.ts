/**
 * Taps on a tempo grid. Not a section map — start time says where beat
 * one is, BPM says how fast. Lanes cycle so the same inputs always
 * write the same chart.
 */
import { LANES, MAX_NOTES, MIN_BPM, MAX_BPM, type Note, type TimingMap } from '@neko/protocol';

export interface GridChart {
  timing: TimingMap;
  notes: Note[];
}

export function gridNotes(input: { startMs: number; bpm: number; durationMs: number }): Note[] {
  const startMs = Math.max(0, input.startMs);
  const durationMs = Math.max(startMs, input.durationMs);
  const bpm = input.bpm;
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return [];

  const period = 60_000 / bpm;
  const notes: Note[] = [];
  let i = 0;
  for (let timeMs = startMs; timeMs < durationMs && notes.length < MAX_NOTES; timeMs += period) {
    i += 1;
    const lane = LANES[(i - 1) % LANES.length];
    if (!lane) break;
    notes.push({
      id: `n${i}`,
      timeMs: Math.round(timeMs),
      lane,
      type: 'tap',
    });
  }
  if (notes.length === 0) {
    notes.push({ id: 'n1', timeMs: Math.round(startMs), lane: 'left', type: 'tap' });
  }
  return notes;
}

export function gridChart(input: { startMs: number; bpm: number; durationMs: number }): GridChart {
  return {
    timing: [{ timeMs: Math.max(0, input.startMs), bpm: input.bpm, beat: 0 }],
    notes: gridNotes(input),
  };
}
