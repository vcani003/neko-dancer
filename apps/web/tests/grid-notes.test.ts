/**
 * Tempo-grid taps. Same start, BPM, and length → same notes, every time.
 */
import { describe, expect, it } from 'vitest';
import { gridChart, gridNotes } from '../src/pages/create/gridNotes.ts';

describe('gridNotes', () => {
  it('places taps from the start time at the BPM, and stops before duration', () => {
    const notes = gridNotes({ startMs: 6000, bpm: 120, durationMs: 8000 });
    expect(notes.map((n) => n.timeMs)).toEqual([6000, 6500, 7000, 7500]);
    expect(notes.map((n) => n.lane)).toEqual(['left', 'down', 'up', 'right']);
    expect(notes.every((n) => n.type === 'tap')).toBe(true);
  });

  it('still writes one note when the start is at the end of the clip', () => {
    const notes = gridNotes({ startMs: 9000, bpm: 120, durationMs: 9000 });
    expect(notes).toEqual([{ id: 'n1', timeMs: 9000, lane: 'left', type: 'tap' }]);
  });

  it('writes a timing point at the start, beat zero', () => {
    const chart = gridChart({ startMs: 6000, bpm: 140, durationMs: 7000 });
    expect(chart.timing).toEqual([{ timeMs: 6000, bpm: 140, beat: 0 }]);
    expect(chart.notes[0]?.timeMs).toBe(6000);
  });
});
