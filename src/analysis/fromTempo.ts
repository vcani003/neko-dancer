/**
 * Generating a chart for audio we are not allowed to hear.
 *
 * A YouTube embed exposes no samples — the developer policies forbid
 * extracting audio and the API offers none regardless — so nothing can analyse
 * it. That rules out onset detection permanently, not temporarily.
 *
 * But onset detection was never the only input the generator needed. What it
 * actually places arrows on is a BEAT GRID, and a grid is two numbers: how
 * fast, and where it starts. A person can supply both by tapping along for a
 * few seconds, which is a thing they can do for any song in the world without
 * anyone's audio leaving anyone's server.
 *
 * So the pipeline for a YouTube song is:
 *
 *   tap ~8 beats  ->  least-squares fit  ->  grid  ->  generator  ->  chart
 *
 * and the only step that differs from the analysed path is where the grid came
 * from. The generator does not know or care.
 */
import type { AudioAnalysis } from './analyze.ts';

export interface TempoGrid {
  bpm: number;
  firstBeatMs: number;
  durationMs: number;
}

/**
 * Present a hand-tapped grid as an analysis.
 *
 * `onsetsMs` is deliberately empty rather than faked. The generator prefers an
 * onset near a beat and falls back to the beat itself, so an empty list means
 * it places arrows squarely on the grid — which is exactly right when the grid
 * is all anyone knows.
 *
 * Confidence is left at zero for the same reason: nothing was measured from
 * audio, and reporting otherwise would be a lie the UI might repeat.
 */
export function analysisFromTempo(grid: TempoGrid): AudioAnalysis {
  const beatMs = 60_000 / grid.bpm;
  const beatsMs: number[] = [];

  // Walk back to the earliest beat at or after zero, so a grid tapped from the
  // middle of a song still covers the start of it.
  let first = grid.firstBeatMs;
  while (first - beatMs >= 0) first -= beatMs;

  for (let t = first; t < grid.durationMs; t += beatMs) {
    beatsMs.push(Math.round(t));
  }

  return {
    bpm: grid.bpm,
    firstBeatMs: first,
    beatsMs,
    onsetsMs: [],
    durationMs: grid.durationMs,
    confidence: 0,
  };
}

/**
 * Pull the video id out of whatever form of YouTube link was pasted.
 *
 * People paste the URL from the address bar, the share sheet, or an embed —
 * all different, all common. Failing on any of them would push the problem
 * onto the player for no reason.
 */
export function youTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A bare id, which is what the share sheet gives after the last slash.
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;

    const match = url.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/);
    if (match) return match[2];
  }

  return null;
}
