/**
 * One-shot reshape of a prototype `localStorage` dump into the domain.
 *
 * ADR-008: v1 is not migrated by the validator. Notes are already absolute,
 * so this is a split — Song / Beatmap / ChartRevision — not a re-tap.
 * Same YouTube id becomes one song and as many beatmaps as there were
 * versions. Running it twice does not duplicate a chart it already wrote.
 */
import { DIFFICULTIES, type Difficulty, type MediaProviderName } from '@neko/protocol';
import type { Store } from '../store.ts';
import type { UserId } from '@neko/protocol';

export const IMPORT_AUTHOR_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' as UserId;

export interface ImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly titles: readonly string[];
}

interface V1Playback {
  provider?: string;
  videoId?: string;
  bpm?: number;
  src?: string;
}

interface V1Chart {
  song?: {
    title?: string;
    artist?: string;
    playback?: V1Playback;
  };
  analysis?: { bpm?: number; generatorVersion?: string };
  plan?: { durationMs?: number };
  difficulty?: string;
  arrows?: ReadonlyArray<{ id?: string; timeMs?: number; lane?: string; type?: string }>;
}

interface V1Record {
  chart: V1Chart;
  id: string;
  author: string;
  version: number;
}

export function parseV1Dump(raw: unknown): V1Record[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('A v1 dump must be an object of localStorage keys.');
  }
  const records: V1Record[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('neko.chart.')) continue;
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (typeof parsed !== 'object' || parsed === null || !('chart' in parsed)) {
      throw new Error(`Dump entry ${key} is not a stored chart.`);
    }
    const record = parsed as V1Record;
    records.push({
      chart: record.chart,
      id: typeof record.id === 'string' ? record.id : key.slice('neko.chart.'.length),
      author: typeof record.author === 'string' ? record.author : 'anon',
      version: typeof record.version === 'number' ? record.version : 1,
    });
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

function mediaOf(playback: V1Playback | undefined): {
  provider: MediaProviderName;
  providerMediaId: string;
} {
  if (playback?.provider === 'youtube' && playback.videoId) {
    return { provider: 'youtube', providerMediaId: playback.videoId };
  }
  if (playback?.provider === 'clickTrack' && typeof playback.bpm === 'number') {
    return { provider: 'clickTrack', providerMediaId: `bpm-${playback.bpm}` };
  }
  if (playback?.provider === 'localAudio' && playback.src) {
    return { provider: 'localAudio', providerMediaId: playback.src };
  }
  throw new Error('Chart is missing usable playback.');
}

function difficultyOf(value: string | undefined): Difficulty {
  return DIFFICULTIES.includes(value as Difficulty) ? (value as Difficulty) : 'normal';
}

function beatmapTitle(record: V1Record, siblings: number): string {
  const base = record.chart.song?.title?.trim() || 'Untitled';
  return siblings > 1 ? `${base} v${record.version}` : base;
}

export async function importV1Dump(store: Store, raw: unknown): Promise<ImportResult> {
  const records = parseV1Dump(raw);
  if (!(await store.getUser(IMPORT_AUTHOR_ID))) {
    await store.createUser({ id: IMPORT_AUTHOR_ID, displayName: 'anon' });
  }

  const byMedia = new Map<string, V1Record[]>();
  for (const record of records) {
    const media = mediaOf(record.chart.song?.playback);
    const key = `${media.provider}:${media.providerMediaId}`;
    const group = byMedia.get(key) ?? [];
    group.push(record);
    byMedia.set(key, group);
  }

  let imported = 0;
  let skipped = 0;
  const titles: string[] = [];

  for (const group of byMedia.values()) {
    const first = group[0];
    if (!first) continue;
    const media = mediaOf(first.chart.song?.playback);
    const arrows = first.chart.arrows ?? [];
    const lastNote = arrows[arrows.length - 1]?.timeMs;
    const durationMs = Math.max(
      1,
      Math.round(first.chart.plan?.durationMs ?? (typeof lastNote === 'number' ? lastNote : 1)),
    );

    let song = await store.findSongByMedia(media.provider, media.providerMediaId);
    if (!song) {
      song = await store.createSong({
        provider: media.provider,
        providerMediaId: media.providerMediaId,
        title: first.chart.song?.title,
        artist: first.chart.song?.artist,
        durationMs,
      });
    }

    for (const record of group) {
      const title = beatmapTitle(record, group.length);
      const already = (await store.listPublished()).some(
        (row) => row.songId === song.id && row.title === title,
      );
      if (already) {
        skipped += 1;
        titles.push(title);
        continue;
      }

      const notes = (record.chart.arrows ?? []).map((arrow) => ({
        id: arrow.id,
        timeMs: arrow.timeMs,
        lane: arrow.lane,
        type: 'tap' as const,
      }));
      const bpm = record.chart.analysis?.bpm ?? 120;
      const beatmap = await store.createBeatmap({
        songId: song.id,
        authorId: IMPORT_AUTHOR_ID,
        title,
        difficulty: difficultyOf(record.chart.difficulty),
        tags: ['import', `v${record.version}`],
      });
      await store.writeRevision(beatmap.id, {
        timing: [{ timeMs: 0, bpm, beat: 0 }],
        notes,
        generatorVersion: record.chart.analysis?.generatorVersion,
      });
      await store.publish(beatmap.id);
      imported += 1;
      titles.push(title);
    }
  }

  return { imported, skipped, titles };
}
