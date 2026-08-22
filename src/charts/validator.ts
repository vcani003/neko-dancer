/**
 * Chart validation.
 *
 * A malformed chart must fail loudly at load rather than produce a song that
 * plays with three unhittable arrows somewhere in the middle. Errors name the
 * arrow that caused them, because "invalid chart" is useless when a file has
 * four hundred entries.
 */
import { CHART_SCHEMA_VERSION, LANES, type Chart } from './schema.ts';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateChart(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['Chart must be an object.'], warnings };
  }
  const chart = input as Partial<Chart>;

  if (chart.schemaVersion !== CHART_SCHEMA_VERSION) {
    errors.push(
      `Unsupported schemaVersion ${String(chart.schemaVersion)} — this build reads ${CHART_SCHEMA_VERSION}.`,
    );
  }

  if (!chart.song) {
    errors.push('Missing `song`.');
  } else {
    if (!chart.song.id) errors.push('Missing `song.id`.');
    if (!chart.song.title) errors.push('Missing `song.title`.');
    const playback = chart.song.playback;
    if (!playback) {
      errors.push('Missing `song.playback`.');
    } else if (playback.provider === 'clickTrack' && !isFiniteNumber(playback.bpm)) {
      errors.push('`clickTrack` playback needs a numeric bpm.');
    } else if (playback.provider === 'localAudio' && !playback.src) {
      errors.push('`localAudio` playback needs a src.');
    } else if (playback.provider === 'youtube' && !playback.videoId) {
      errors.push('`youtube` playback needs a videoId.');
    }
  }

  if (!chart.analysis) {
    errors.push('Missing `analysis`.');
  } else {
    if (!isFiniteNumber(chart.analysis.bpm) || chart.analysis.bpm <= 0) {
      errors.push('`analysis.bpm` must be a positive number.');
    }
    if (!isFiniteNumber(chart.analysis.offsetMs)) {
      errors.push('`analysis.offsetMs` must be a number.');
    }
  }

  if (!Array.isArray(chart.arrows)) {
    errors.push('`arrows` must be an array.');
    return { ok: errors.length === 0, errors, warnings };
  }

  const seen = new Set<string>();
  let previousTime = -Infinity;

  chart.arrows.forEach((a, index) => {
    const where = `arrow[${index}]${a?.id ? ` (${a.id})` : ''}`;
    if (!a || typeof a !== 'object') {
      errors.push(`${where} is not an object.`);
      return;
    }
    if (!a.id) errors.push(`${where} is missing an id.`);
    else if (seen.has(a.id)) errors.push(`${where} has a duplicate id.`);
    else seen.add(a.id);

    if (!isFiniteNumber(a.timeMs) || a.timeMs < 0) {
      errors.push(`${where} needs a timeMs of zero or more.`);
    } else {
      // Sorted order is not cosmetic: the engine walks forward and never looks
      // back at an arrow it has passed.
      if (a.timeMs < previousTime) {
        errors.push(`${where} is out of order — arrows must be sorted by timeMs.`);
      }
      previousTime = a.timeMs;
    }

    if (!LANES.includes(a.lane)) errors.push(`${where} has unknown lane "${String(a.lane)}".`);
    if (a.type !== 'tap') errors.push(`${where} has unsupported type "${String(a.type)}".`);
  });

  if (chart.arrows.length === 0) warnings.push('Chart has no arrows.');

  return { ok: errors.length === 0, errors, warnings };
}

/** Validate and narrow, or throw with every problem listed at once. */
export function parseChart(input: unknown): Chart {
  const result = validateChart(input);
  if (!result.ok) throw new Error(`Invalid chart:\n  ${result.errors.join('\n  ')}`);
  return input as Chart;
}
