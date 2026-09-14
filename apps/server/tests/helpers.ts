/**
 * A fresh in-memory store per test. PGlite is the whole database, so
 * nothing leaks between cases and nothing here reaches a network.
 */
import { frozenClock, openMemoryDb, Store } from '@neko/server';
import type { OpenDb } from '@neko/server';

export const NOW = '2026-03-01T12:00:00.000Z';

export const tap = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  timeMs: 1000,
  lane: 'up',
  type: 'tap',
  ...over,
});

export const timing = () => [{ timeMs: 0, bpm: 120, beat: 0 }];

export const aRound = (over: Record<string, unknown> = {}) => ({
  score: 1000,
  combo: 4,
  accuracy: 1,
  health: 100,
  maxCombo: 4,
  counts: { PERFECT: 4, GREAT: 0, GOOD: 0, OKAY: 0, MISS: 0 },
  completed: true,
  ...over,
});

export async function openTestStore(): Promise<{ store: Store; db: OpenDb['db']; client: OpenDb['client'] }> {
  const opened = await openMemoryDb();
  return { store: new Store(opened.db, frozenClock(NOW)), ...opened };
}
