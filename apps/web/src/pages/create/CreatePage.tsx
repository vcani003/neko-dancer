/**
 * One screen: paste, embed, start time, BPM, then Draft or Publish.
 *
 * Submit does not navigate. Publish is a request — Staging still has to
 * confirm before the chart is public. Title comes from the video.
 */
import { useEffect, useMemo, useState } from 'react';
import { fitTempo, MIN_TAPS } from '@neko/game-core';
import { MAX_BPM, MIN_BPM } from '@neko/protocol';
import type { MediaSource } from '@neko/protocol';
import { MediaResolveError } from '../../playback/MediaProvider.ts';
import { YouTubeProvider } from '../../playback/YouTubeProvider.ts';
import { HttpCatalog } from '../../play/HttpCatalog.ts';
import { Nav } from '../shared/Nav.tsx';
import { gridChart } from './gridNotes.ts';
import { parseClock } from './parseClock.ts';

const DEFAULT_DURATION_MS = 90_000;

export function CreatePage() {
  const catalog = useMemo(() => new HttpCatalog(), []);
  const provider = useMemo(() => new YouTubeProvider(), []);
  const [url, setUrl] = useState('');
  const [source, setSource] = useState<MediaSource | null>(null);
  const [start, setStart] = useState('0:00');
  const [bpm, setBpm] = useState('120');
  const [taps, setTaps] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishNote, setPublishNote] = useState(false);

  useEffect(() => {
    void catalog.me().catch(() => {
      setError('The store is not running. In another terminal, from this repo: npm run api');
    });
  }, [catalog]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!source) return;
      event.preventDefault();
      const at = event.timeStamp;
      setTaps((prev) => {
        const next = [...prev, at];
        const fit = fitTempo(next);
        if (fit) setBpm(String(Math.round(fit.bpm)));
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source]);

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    setPublishNote(false);
    try {
      const resolved = await provider.resolve(url);
      setSource(resolved);
      setTaps([]);
    } catch (err) {
      setSource(null);
      if (err instanceof MediaResolveError) setError(err.message);
      else setError(err instanceof Error ? err.message : 'Could not look that video up.');
    } finally {
      setBusy(false);
    }
  }

  function typeBpm(value: string): void {
    setBpm(value);
    setTaps([]);
  }

  async function save(intent: 'draft' | 'publish'): Promise<void> {
    if (!source) return;
    const startMs = parseClock(start);
    const tempo = Number(bpm);
    if (startMs === null) {
      setError('Start time looks like 0:06 or 1:12.');
      return;
    }
    if (!Number.isFinite(tempo) || tempo < MIN_BPM || tempo > MAX_BPM) {
      setError(`BPM has to be between ${MIN_BPM} and ${MAX_BPM}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const chart = gridChart({ startMs, bpm: tempo, durationMs: DEFAULT_DURATION_MS });
      const created = await catalog.createChart({
        providerMediaId: source.providerMediaId,
        title: source.title,
        artist: source.creator,
        durationMs: DEFAULT_DURATION_MS,
        thumbnailUrl: source.thumbnailUrl,
        timing: chart.timing,
        notes: chart.notes,
      });
      const params = new URLSearchParams({
        room: 'staging',
        revision: created.revision.id,
        beatmap: created.beatmap.id,
        intent,
      });
      window.location.assign(`/rooms.html?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that chart.');
      setBusy(false);
    }
  }

  const startMs = parseClock(start);
  const tempo = Number(bpm);
  const canSave =
    !!source && startMs !== null && Number.isFinite(tempo) && tempo >= MIN_BPM && tempo <= MAX_BPM && !busy;

  return (
    <div className="door">
      <Nav here="create" />
      <h1>
        Create <span>a chart</span>
      </h1>
      <p className="hint">Paste a YouTube link. Timing stays on this page. Publish still has to run Staging.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field-row">
          <label htmlFor="yt-url">YouTube</label>
          <input
            id="yt-url"
            value={url}
            placeholder="https://youtube.com/watch?v=…"
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <div className="actions" style={{ marginTop: '0.6rem' }}>
          <button type="submit" className="button--primary" disabled={busy || !url.trim()}>
            Submit
          </button>
        </div>
      </form>

      {source && (
        <>
          <div className="embed">
            <iframe
              src={`https://www.youtube.com/embed/${source.providerMediaId}`}
              title={source.title}
              allow="autoplay; encrypted-media"
            />
          </div>
          <p className="hint">
            {source.title}
            {source.creator ? ` · ${source.creator}` : ''}
          </p>

          <div className="field-row">
            <label htmlFor="start-time">Start</label>
            <input
              id="start-time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              placeholder="0:06"
            />
          </div>
          <div className="field-row">
            <label htmlFor="bpm">BPM</label>
            <input id="bpm" value={bpm} onChange={(event) => typeBpm(event.target.value)} inputMode="decimal" />
          </div>
          <div
            className="tap-pad"
            tabIndex={0}
            onClick={(event) => (event.currentTarget as HTMLDivElement).focus()}
          >
            Click here and tap space while the video plays.
            {taps.length > 0 &&
              ` ${taps.length} tap${taps.length === 1 ? '' : 's'}${taps.length < MIN_TAPS ? ` — ${MIN_TAPS} to lock a tempo` : ''}.`}
          </div>

          <details className="advanced">
            <summary>Advanced Beatmap settings</summary>
            <p>Holds, extra timing points, and hand edits will live here.</p>
          </details>
        </>
      )}

      {error && <div className="error">{error}</div>}

      {publishNote && (
        <div className="note">
          This will not go into the public room yet. You will play it in Staging first.
        </div>
      )}

      <div className="actions">
        <a href="/">Exit</a>
        <button type="button" disabled={!canSave} onClick={() => void save('draft')}>
          Draft
        </button>
        {publishNote ? (
          <button type="button" className="button--primary" disabled={!canSave} onClick={() => void save('publish')}>
            Confirm publish
          </button>
        ) : (
          <button type="button" className="button--primary" disabled={!canSave} onClick={() => setPublishNote(true)}>
            Publish
          </button>
        )}
      </div>
    </div>
  );
}
