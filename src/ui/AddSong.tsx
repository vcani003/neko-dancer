/**
 * Adding a song by URL, and charting it by tapping.
 *
 * This is the original's "Processing" step, done the only way a YouTube song
 * allows. The embed hands us a clock and nothing else, so the beat grid comes
 * from a person tapping along — and once there is a grid, the generator does
 * the rest.
 *
 * Taps are timestamped against the PLAYER'S clock, not wall time. The grid has
 * to live in the same timebase the chart will be judged in, or it would be
 * correct at the moment of tapping and wrong on every replay.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fitTempo, normaliseBpm, MIN_TAPS, type TempoFit } from '../charts/ChartRecorder.ts';
import { analysisFromTempo, youTubeVideoId } from '../analysis/fromTempo.ts';
import { flatPlan, inferPlanFromTaps } from '../charts/SongPlan.ts';
import { generateChart, type GeneratedDifficulty } from '../analysis/generate.ts';
import { YouTubeAdapter } from '../playback/YouTubeAdapter.ts';
import type { Chart } from '../charts/schema.ts';

type Step = 'url' | 'loading' | 'tapping' | 'done';

interface Props {
  onCharted: (chart: Chart) => void;
  onCancel: () => void;
}

/** Enough taps to be sure, few enough that nobody minds. */
const TARGET_TAPS = 8;

/** m:ss — a duration a person can compare against a song they know. */
function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function AddSong({ onCharted, onCancel }: Props) {
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  /**
   * Every tap, kept separately from the tempo taps.
   *
   * The first handful establish the grid; the rest describe the song — where
   * the player stopped tapping is a passage with nothing worth hitting, and
   * how fast they tapped is how busy it felt. Discarding them to keep only an
   * average tempo throws away most of what was expressed.
   */
  const [shapeTaps, setShapeTaps] = useState<number[]>([]);
  const [fit, setFit] = useState<TempoFit | null>(null);
  /** Read once the video is ready, so coverage can be shown while tapping. */
  const durationRef = useRef<number | null>(null);
  const [difficulty, setDifficulty] = useState<GeneratedDifficulty>('normal');

  const playerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<YouTubeAdapter | null>(null);
  const videoIdRef = useRef<string | null>(null);

  useEffect(() => () => adapterRef.current?.dispose(), []);

  const load = useCallback(async () => {
    const videoId = youTubeVideoId(url);
    if (!videoId) {
      setError('That does not look like a YouTube link.');
      return;
    }

    setError(null);
    setStep('loading');
    videoIdRef.current = videoId;

    try {
      adapterRef.current?.dispose();
      adapterRef.current = await YouTubeAdapter.create({
        videoId,
        container: playerRef.current!,
      });
      // Read once here rather than at build time, so the coverage line can be
      // shown while tapping — which is the only moment it can change a decision.
      durationRef.current = adapterRef.current.getDurationMs() ?? null;
      setStep('tapping');
      setTaps([]);
      setFit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That video could not be loaded.');
      setStep('url');
    }
  }, [url]);

  /**
   * Record a tap at the player's current position.
   *
   * Guarded on the player actually running: taps collected while it is paused
   * or buffering all land at the same instant and would fit a nonsense tempo.
   */
  const tap = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter || adapter.getState() !== 'playing') return;

    const at = adapter.getCurrentTimeMs();
    setShapeTaps((previous) => [...previous, at]);
    setTaps((previous) => {
      const next = [...previous, at];
      setFit(fitTempo(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (step !== 'tapping') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      // Space would otherwise scroll the page or re-trigger a focused button.
      event.preventDefault();
      if (!event.repeat) tap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, tap]);

  /**
   * How the taps are read.
   *
   * `quick` uses them for TEMPO ONLY — a handful of beats says where the grid
   * is, and the chart is generated across the whole song from it.
   *
   * `shape` additionally reads them as the song's structure: gaps become
   * passages with no arrows, denser stretches become busier ones.
   *
   * The distinction is the whole point. Read as shape, forty taps to find the
   * BPM of a four-minute song said "this song is thirteen seconds long and then
   * silent", and produced a chart to match — quietly, with nothing to indicate
   * that ninety-five per cent of it had been skipped.
   */
  /**
   * How much of the song the taps actually cover.
   *
   * The number that decides which mode you want, and the one whose absence made
   * the old behaviour a trap: you tapped, you got a chart, and nothing said the
   * rest of the song had been thrown away.
   */
  const coverage = (() => {
    const durationMs = durationRef.current;
    if (shapeTaps.length < 2 || !durationMs) return null;
    const tappedMs = shapeTaps[shapeTaps.length - 1] - shapeTaps[0];
    return { tappedMs, durationMs, fraction: Math.min(1, tappedMs / durationMs) };
  })();

  const makeChart = useCallback((mode: 'quick' | 'shape') => {
    const adapter = adapterRef.current;
    const videoId = videoIdRef.current;
    if (!fit || !adapter || !videoId) return;

    const bpm = normaliseBpm(fit.bpm);
    // The grid was fitted at whatever tempo was tapped; if that was halved or
    // doubled, the phase still holds — only the spacing changes.
    const durationMs = adapter.getDurationMs() ?? 180_000;
    const analysis = analysisFromTempo({ bpm, firstBeatMs: fit.firstBeatMs, durationMs });

    const plan =
      mode === 'shape'
        ? // Everything tapped, not just the tempo: gaps become skipped passages
          // and faster stretches become busier ones. Where you stop, the song
          // goes quiet — deliberate for now, and expected to be reworked.
          inferPlanFromTaps(shapeTaps, bpm, fit.firstBeatMs, durationMs)
        : // Tempo only. One section, the whole song, even throughout.
          flatPlan(bpm, fit.firstBeatMs, durationMs);

    onCharted(
      generateChart(analysis, {
        difficulty,
        plan,
        song: {
          id: `youtube:${videoId}`,
          title: title.trim() || 'Untitled',
          artist: 'YouTube',
          playback: { provider: 'youtube', videoId },
        },
      }),
    );
    setStep('done');
    // shapeTaps must be a dependency: without it the plan would be inferred
    // from whatever the tap list was when this callback was last built, which
    // is every tap except the recent ones — exactly the ones describing the
    // end of the song.
  }, [fit, difficulty, title, onCharted, shapeTaps]);

  const enough = taps.length >= MIN_TAPS;
  const shownBpm = fit ? normaliseBpm(fit.bpm) : null;
  // Residual is how far the taps sat from the grid they produced. Under ~25 ms
  // is a person keeping time; well above it is a person guessing.
  const steady = fit ? fit.residualMs < 25 : false;

  return (
    <div className="panel">
      <h2>Add a song</h2>

      {step === 'url' && (
        <>
          <p className="hint">
            Paste a YouTube link. The video plays here and you tap the beat — its
            audio is never downloaded or read, so the rhythm has to come from you.
          </p>
          <input
            value={url}
            placeholder="https://youtube.com/watch?v=..."
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
          <input
            value={title}
            placeholder="song title"
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
          />
          {error && <p className="hint" style={{ color: 'var(--bad)' }}>{error}</p>}
          <button className="button--primary" onClick={load}>Load it</button>
          <button onClick={onCancel}>Back</button>
        </>
      )}

      {/* The player is mounted once and kept mounted. Tearing it down between
          steps would reload the video and lose the position. It also has to
          stay visible and usable — that is YouTube's requirement, and it is
          how the person tapping can hear what they are tapping to. */}
      <div className="ytplayer" ref={playerRef} style={{ display: step === 'url' ? 'none' : 'block' }} />

      {step === 'loading' && <p className="hint">Loading the video…</p>}

      {step === 'tapping' && (
        <>
          <p className="hint">
            Press play on the video, then tap <kbd>space</kbd> on each beat —
            about {TARGET_TAPS} of them. Count along out loud if it helps.
          </p>
          <p className="hint" style={{ fontSize: '0.72rem' }}>
            Your taps <em>are</em> the analysis. Nothing reads the audio; the tempo is
            worked out from how evenly you tapped, and the chart is built on that.
          </p>

          <button className="button--primary" onClick={tap}>
            Tap the beat ({taps.length})
          </button>

          <div className="tapmeter">
            <div
              className="tapmeter__fill"
              style={{ width: `${Math.min(100, (taps.length / TARGET_TAPS) * 100)}%` }}
            />
          </div>

          {shownBpm !== null && (
            <div className="tapresult">
              <span className="tapresult__bpm mono">{shownBpm.toFixed(1)} BPM</span>
              <span
                className="tapresult__quality"
                style={{ color: steady ? 'var(--green)' : 'var(--gold)' }}
              >
                {steady
                  ? `steady — your taps sat ${fit!.residualMs.toFixed(0)} ms from the beat`
                  : `still settling — ${fit!.residualMs.toFixed(0)} ms of scatter, keep going`}
              </span>
              {shownBpm !== fit!.bpm && (
                <span className="tapresult__note">
                  Read as {fit!.bpm.toFixed(0)}, folded to {shownBpm.toFixed(0)} — tapping
                  every other beat, or twice per beat, is easy to do.
                </span>
              )}
            </div>
          )}

          <div className="difficulty">
            {(['easy', 'normal', 'hard'] as const).map((d) => (
              <button
                key={d}
                className={difficulty === d ? 'is-active' : ''}
                onClick={() => setDifficulty(d)}
              >
                {d}
              </button>
            ))}
          </div>

          {coverage && (
            <p className="hint" style={{ fontSize: '0.72rem' }}>
              {taps.length} taps · covering {formatMs(coverage.tappedMs)} of{' '}
              {formatMs(coverage.durationMs)} ({Math.round(coverage.fraction * 100)}%)
            </p>
          )}

          {/*
            The label stays the action, disabled or not. It used to swap to
            "4 more taps", which is a requirement wearing a button's clothes —
            it reads as though pressing it would produce the taps. The count is
            already on the tap button, in the meter beneath it, and in the
            instruction above; a fourth copy of it was not the missing piece.
          */}
          <button
            className="button--primary"
            onClick={() => makeChart('quick')}
            disabled={!enough}
            title={enough ? undefined : `Tap at least ${MIN_TAPS} beats first`}
          >
            Quick chart — use my taps for the tempo
          </button>
          <p className="hint" style={{ fontSize: '0.7rem' }}>
            Arrows across the whole song, evenly. Tap eight beats or eighty — it only
            needs to know where the beat is.
          </p>

          <button
            onClick={() => makeChart('shape')}
            disabled={!enough}
            title={enough ? undefined : `Tap at least ${MIN_TAPS} beats first`}
          >
            Use my tapping as the shape
          </button>
          <p className="hint" style={{ fontSize: '0.7rem' }}>
            For when you have tapped through the whole song. Where you tap faster
            becomes busier, and <strong>where you stop, the song goes quiet.</strong>
            {coverage && coverage.fraction < 0.5 && (
              <>
                {' '}You have covered {Math.round(coverage.fraction * 100)}% — the other{' '}
                {Math.round((1 - coverage.fraction) * 100)}% would have no arrows at all.
              </>
            )}
          </p>

          <button
            onClick={() => { setTaps([]); setShapeTaps([]); setFit(null); }}
            disabled={taps.length === 0}
          >
            Clear taps and start over
          </button>
          <button onClick={onCancel}>Cancel</button>
        </>
      )}
    </div>
  );
}
