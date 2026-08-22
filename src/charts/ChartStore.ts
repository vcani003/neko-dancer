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
 * Keyed by playback source, so a YouTube video id maps to whatever chart was
 * written for it. Local storage today. The interface is deliberately async and
 * narrow so the same calls can hit a server later, which is what makes a chart
 * charted by one person playable by everyone in the room.
 */
import type { Chart } from './schema.ts';
import { validateChart } from './validator.ts';

const STORAGE_PREFIX = 'neko.chart.';

/** A stable key for whatever this chart is played against. */
export function chartKey(chart: Chart): string {
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

export interface StoredChart {
  chart: Chart;
  savedAtIso: string;
  /** Who tapped it, when that becomes something we know. */
  authoredBy?: string;
}

export interface ChartStore {
  get(key: string): Promise<StoredChart | null>;
  put(chart: Chart, authoredBy?: string): Promise<void>;
  list(): Promise<StoredChart[]>;
  remove(key: string): Promise<void>;
}

/**
 * Charts in this browser.
 *
 * Every read is validated rather than trusted. Stored data outlives the code
 * that wrote it — a chart saved by an older build, or edited by hand, must not
 * be able to crash a song by being merely plausible.
 */
export class LocalChartStore implements ChartStore {
  async get(key: string): Promise<StoredChart | null> {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;
      const stored = JSON.parse(raw) as StoredChart;
      if (!validateChart(stored?.chart).ok) return null;
      return stored;
    } catch {
      return null;
    }
  }

  async put(chart: Chart, authoredBy?: string): Promise<void> {
    const result = validateChart(chart);
    // Refusing to store an invalid chart keeps the problem at the point it was
    // created, rather than surfacing it as a broken song days later.
    if (!result.ok) throw new Error(`Refusing to store an invalid chart:\n  ${result.errors.join('\n  ')}`);

    const stored: StoredChart = {
      chart,
      savedAtIso: new Date().toISOString(),
      ...(authoredBy ? { authoredBy } : {}),
    };
    try {
      localStorage.setItem(STORAGE_PREFIX + chartKey(chart), JSON.stringify(stored));
    } catch {
      // A full quota should not take a song down with it.
    }
  }

  async list(): Promise<StoredChart[]> {
    const charts: StoredChart[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const stored = await this.get(key.slice(STORAGE_PREFIX.length));
      if (stored) charts.push(stored);
    }
    return charts.sort((a, b) => b.savedAtIso.localeCompare(a.savedAtIso));
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(STORAGE_PREFIX + key);
  }
}

/** In memory, for tests and for a server that has not been written yet. */
export class MemoryChartStore implements ChartStore {
  private charts = new Map<string, StoredChart>();

  async get(key: string): Promise<StoredChart | null> {
    return this.charts.get(key) ?? null;
  }

  async put(chart: Chart, authoredBy?: string): Promise<void> {
    const result = validateChart(chart);
    if (!result.ok) throw new Error(`Refusing to store an invalid chart:\n  ${result.errors.join('\n  ')}`);
    this.charts.set(chartKey(chart), {
      chart,
      savedAtIso: new Date().toISOString(),
      ...(authoredBy ? { authoredBy } : {}),
    });
  }

  async list(): Promise<StoredChart[]> {
    return [...this.charts.values()];
  }

  async remove(key: string): Promise<void> {
    this.charts.delete(key);
  }
}
