/**
 * Neko Dancer.
 *
 * One loop, in a deliberate order: bring the clock up to date, retire arrows
 * whose window closed, draw against that one timestamp. Keypresses arrive on
 * their own schedule and are judged the moment they land, using the instant
 * the key actually went down.
 *
 * React renders the shell and, at 10 Hz, the score. Everything the player
 * feels is drawn by PixiJS.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameClock } from './engine/GameClock.ts';
import { GameEngine, type JudgmentEvent } from './engine/GameEngine.ts';
import { DEFAULT_WINDOWS } from './engine/LaneJudge.ts';
import {
  accuracy,
  grade,
  initialScoreState,
  meanDeltaMs,
  nextGrade,
  suggestedOffsetMs,
  type ScoreState,
} from './engine/ScoreSystem.ts';
import { chartDurationMs, LANES, type Lane } from './charts/schema.ts';
import { TUTORIAL_CHART } from './charts/library.ts';
import { ClickTrackAdapter } from './playback/ClickTrackAdapter.ts';
import { YouTubeAdapter } from './playback/YouTubeAdapter.ts';
import type { PlaybackAdapter } from './playback/PlaybackAdapter.ts';
import { LocalChartStore, chartKey, type StoredChart } from './charts/ChartStore.ts';
import AddSong from './ui/AddSong.tsx';
import { KeyboardInput } from './input/KeyboardInput.ts';
import { DEFAULT_LEAD_MS, LaneRenderer } from './render/LaneRenderer.ts';
import { C2S, useRoom } from './net/useRoom.ts';

type Phase = 'menu' | 'adding' | 'playing' | 'results';

const HUD_INTERVAL_MS = 100;

const ARROW_GLYPH: Record<Lane, string> = {
  left: '←',
  down: '↓',
  up: '↑',
  right: '→',
};

interface HudView {
  score: ScoreState;
  playbackTimeMs: number;
  durationMs: number;
}

const EMPTY_HUD: HudView = {
  score: initialScoreState(),
  playbackTimeMs: 0,
  durationMs: 0,
};

export default function App() {
  const [phase, setPhase] = useState<Phase>('menu');
  const [hud, setHud] = useState<HudView>(EMPTY_HUD);
  const [error, setError] = useState<string | null>(null);

  /**
   * Milliseconds added to judged time.
   *
   * A consistent bias is calibration, not skill — someone hitting 40 ms early
   * every time is accurate against a clock that disagrees with them, and one
   * number fixes it where practice never would.
   */
  const [offsetMs, setOffsetMs] = useState(() => Number(localStorage.getItem('neko.offset') ?? 0));
  const [name, setName] = useState(() => localStorage.getItem('neko.name') ?? '');
  // Room comes from the URL so a shared link lands people in the same place:
  // http://<address>/?room=friday
  const [roomId] = useState(
    () =>
      new URLSearchParams(window.location.search).get('room') ??
      localStorage.getItem('neko.room') ??
      'lobby',
  );
  const [draft, setDraft] = useState('');

  /**
   * Charts this browser knows about: the one that ships, plus every song
   * anyone has charted here. Charted once, replayable forever — which is the
   * whole point of caching them.
   */
  const store = useMemo(() => new LocalChartStore(), []);
  const [saved, setSaved] = useState<StoredChart[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(chartKey(TUTORIAL_CHART));

  const refreshCharts = useCallback(() => {
    void store.list().then(setSaved);
  }, [store]);
  useEffect(refreshCharts, [refreshCharts]);

  const allCharts = useMemo(
    () => [TUTORIAL_CHART, ...saved.map((s) => s.chart)],
    [saved],
  );
  const chart = useMemo(
    () => allCharts.find((c) => chartKey(c) === selectedKey) ?? TUTORIAL_CHART,
    [allCharts, selectedKey],
  );
  const durationMs = useMemo(() => chartDurationMs(chart), [chart]);

  const stageRef = useRef<HTMLDivElement>(null);
  /**
   * Where the YouTube player lives during play.
   *
   * Mounted permanently and merely hidden when unused. YouTube requires the
   * player visible and functional while it is driving playback — that is their
   * policy and it is also just correct, since it is someone's work and the
   * player is how they get credited and controlled.
   */
  const youtubeRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LaneRenderer | null>(null);
  const adapterRef = useRef<PlaybackAdapter | null>(null);
  const clockRef = useRef<GameClock | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const inputRef = useRef<KeyboardInput | null>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>('menu');

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const room = useRoom(name || 'neko', roomId, true);

  useEffect(() => {
    if (name) localStorage.setItem('neko.name', name);
    localStorage.setItem('neko.room', roomId);
    localStorage.setItem('neko.offset', String(offsetMs));
  }, [name, roomId, offsetMs]);

  /** Applies mid-song too, so a correction can be felt without restarting. */
  const applyOffset = useCallback((value: number) => {
    setOffsetMs(value);
    clockRef.current?.setOffsetMs(value);
  }, []);

  const present = useCallback((events: readonly JudgmentEvent[]) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const now = performance.now();
    for (const event of events) {
      if (event.judgment) renderer.showJudgment(event.judgment, event.lane, now);
    }
  }, []);

  // ---- PixiJS lifecycle ----
  useEffect(() => {
    let cancelled = false;
    const renderer = new LaneRenderer();
    const container = stageRef.current;
    if (!container) return;

    renderer
      .init(container)
      .then(() => {
        if (cancelled) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'The renderer failed to start.');
      });

    return () => {
      cancelled = true;
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  // ---- keyboard ----
  useEffect(() => {
    const input = new KeyboardInput({
      onPress: ({ lane, atMs }) => {
        const engine = engineRef.current;
        if (!engine || phaseRef.current !== 'playing') return;
        // Move the cat on the key, not on the verdict. A dancer that waits to
        // find out whether it was a good hit is a dancer that lags behind the
        // player's own hands.
        rendererRef.current?.reactToPress(lane, performance.now());
        const event = engine.pressLane(lane, atMs);
        if (event) present([event]);
      },
    });
    input.attach();
    inputRef.current = input;
    return () => {
      input.detach();
      inputRef.current = null;
    };
  }, [present]);

  // ---- the loop ----
  useEffect(() => {
    const step = () => {
      const now = performance.now();
      const clock = clockRef.current;
      const engine = engineRef.current;

      if (clock && engine && phaseRef.current === 'playing') {
        clock.tick();
        present(engine.update());
        // isOver, not isComplete: a failed run stops judging, so the chart
        // never finishes and isComplete would never become true.
        if (engine.isOver()) {
          room.send(C2S.FINISH, {});
          setPhase('results');
        }
      }

      const renderer = rendererRef.current;
      if (renderer) {
        renderer.render({
          arrows: engine ? engine.getArrows() : [],
          playbackTimeMs: clock ? clock.rawTimeMs() : 0,
          heldLanes: inputRef.current?.heldLanes() ?? new Set<Lane>(),
          leadMs: DEFAULT_LEAD_MS,
          nowMs: now,
          bpm: phaseRef.current === 'playing' ? chart.analysis.bpm : 0,
        });
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [present, room, chart]);

  // ---- the cold path: HUD and the room's scoreboard ----
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      const clock = clockRef.current;
      if (!engine || !clock) return;
      const score = engine.getScore();
      setHud({ score, playbackTimeMs: clock.rawTimeMs(), durationMs });
      room.send(C2S.SCORE, { score: score.score, combo: score.combo, health: score.health });
    }, HUD_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phase, durationMs, room]);

  const start = useCallback(async () => {
    setError(null);
    adapterRef.current?.dispose();
    rendererRef.current?.clearEffects();

    const playback = chart.song.playback;
    let adapter: PlaybackAdapter;

    try {
      if (playback.provider === 'youtube') {
        youtubeRef.current!.replaceChildren();
        adapter = await YouTubeAdapter.create({
          videoId: playback.videoId,
          container: youtubeRef.current!,
        });
      } else {
        adapter = new ClickTrackAdapter({
          bpm: playback.provider === 'clickTrack' ? playback.bpm : chart.analysis.bpm,
          beatsPerBar: playback.provider === 'clickTrack' ? (playback.beatsPerBar ?? 4) : 4,
          bars: playback.provider === 'clickTrack' ? (playback.bars ?? 20) : 20,
          leadInBars: 1,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That song could not be loaded.');
      setPhase('menu');
      return;
    }

    adapterRef.current = adapter;
    const clock = new GameClock(adapter, { offsetMs });
    clockRef.current = clock;
    engineRef.current = new GameEngine(clock, chart, { windows: DEFAULT_WINDOWS });

    try {
      await adapter.play();
      clock.reset();
      room.send(C2S.START, { songId: chart.song.id });
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start audio.');
      setPhase('menu');
    }
  }, [chart, room, offsetMs]);

  const quit = useCallback(() => {
    adapterRef.current?.dispose();
    adapterRef.current = null;
    clockRef.current = null;
    engineRef.current = null;
    rendererRef.current?.clearEffects();
    setPhase('menu');
    setHud(EMPTY_HUD);
  }, []);

  useEffect(() => () => adapterRef.current?.dispose(), []);

  const score = hud.score;
  const live = phase === 'playing';
  const progress = hud.durationMs > 0 ? Math.min(1, Math.max(0, hud.playbackTimeMs / hud.durationMs)) : 0;
  const healthColour =
    score.health > 60 ? 'var(--green)' : score.health > 25 ? 'var(--gold)' : 'var(--bad)';

  return (
    <div className="app">
      <div className="field" ref={stageRef}>
        {live && (
          <>
            <div className="hud">
              <div>
                <div className="hud__score mono">{score.score.toLocaleString()}</div>
                {score.combo > 1 && <div className="hud__combo mono">{score.combo}x</div>}
              </div>
              <div className="hud__right">
                <div className="hud__accuracy mono">{(accuracy(score) * 100).toFixed(1)}%</div>
                <div className="health">
                  <div
                    className="health__fill"
                    style={{ width: `${score.health}%`, background: healthColour }}
                  />
                </div>
              </div>
            </div>
            <div className="progress">
              <div className="progress__fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </>
        )}

        {phase === 'menu' && (
          <div className="overlay">
            <div className="panel">
              <h1>neko <span>dancer</span></h1>
              <p className="hint">{chart.song.title} · {chart.arrows.length} arrows</p>

              <div className="songlist">
                {allCharts.map((c) => {
                  const key = chartKey(c);
                  return (
                    <button
                      key={key}
                      className={`songrow ${key === selectedKey ? 'is-active' : ''}`}
                      onClick={() => setSelectedKey(key)}
                    >
                      <span>
                        <span className="songrow__title">{c.song.title}</span>
                        <br />
                        <span className="songrow__meta">
                          {c.arrows.length} arrows · {c.analysis.bpm.toFixed(0)} BPM ·{' '}
                          {c.source === 'generated' ? 'tapped' : 'hand-written'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <button onClick={() => setPhase('adding')}>Add a song from YouTube</button>

              <div className="keycaps">
                {LANES.map((lane) => (
                  <span key={lane} className="keycap">{ARROW_GLYPH[lane]}</span>
                ))}
              </div>
              <p className="hint">
                Hit the arrow key as its arrow reaches the line. Arrow keys or WASD.
                Missing drains your health — run out and the song ends.
              </p>

              {error && <p className="hint" style={{ color: 'var(--bad)' }}>{error}</p>}
              <button className="button--primary" onClick={start}>Play</button>
            </div>
          </div>
        )}

        {phase === 'adding' && (
          <div className="overlay">
            <AddSong
              onCancel={() => setPhase('menu')}
              onCharted={(newChart) => {
                void store.put(newChart, name || undefined).then(() => {
                  refreshCharts();
                  setSelectedKey(chartKey(newChart));
                  setPhase('menu');
                });
              }}
            />
          </div>
        )}

        {phase === 'results' && (
          <div className="panel-wrap overlay">
            <div className="panel">
              <p className="hint">{score.failed ? 'You ran out of health' : 'Cleared'}</p>
              <div
                className="results__grade"
                style={{ color: score.failed ? 'var(--bad)' : 'var(--pink)' }}
              >
                {grade(score)}
              </div>
              <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 700 }}>
                {score.score.toLocaleString()}
              </div>

              <div className="results__grid">
                {(['PERFECT', 'NICE', 'OKAY', 'OOPS', 'MISS'] as const).map((j) => (
                  <div key={j}>
                    <span className="results__k">{j}</span>
                    <span className="results__v mono">{score.counts[j]}</span>
                  </div>
                ))}
                <div>
                  <span className="results__k">MAX COMBO</span>
                  <span className="results__v mono">{score.maxCombo}</span>
                </div>
              </div>

              {/* The grade comes from accuracy, so accuracy is shown. A grade
                  whose arithmetic is invisible just feels like a verdict. */}
              <div className="accuracy">
                <span className="accuracy__value mono">{(accuracy(score) * 100).toFixed(1)}%</span>
                <span className="accuracy__label">
                  accuracy — {score.judgedCount - score.counts.MISS} of {score.judgedCount} arrows hit,
                  weighted by how close each was
                </span>
                {nextGrade(score) && (
                  <span className="accuracy__next">
                    {(nextGrade(score)!.min * 100).toFixed(0)}% for a {nextGrade(score)!.grade}
                  </span>
                )}
              </div>

              <p className="hint">
                {meanDeltaMs(score) === null
                  ? 'Nothing landed.'
                  : `Average timing ${meanDeltaMs(score)! > 0 ? '+' : ''}${meanDeltaMs(score)!.toFixed(0)} ms ${meanDeltaMs(score)! > 0 ? 'late' : 'early'}.`}
              </p>

              {(() => {
                const suggestion = suggestedOffsetMs(score, offsetMs);
                if (suggestion === null || suggestion === offsetMs) return null;
                const mean = meanDeltaMs(score)!;
                return (
                  <button onClick={() => applyOffset(suggestion)}>
                    You were {Math.abs(mean).toFixed(0)} ms {mean > 0 ? 'late' : 'early'} —
                    {' '}shift timing to {suggestion > 0 ? '+' : ''}{suggestion} ms
                  </button>
                );
              })()}

              <button className="button--primary" onClick={start}>Play again</button>
              <button onClick={quit}>Menu</button>
            </div>
          </div>
        )}
      </div>

      <aside className="side">
        <div
          className="card"
          style={{ display: chart.song.playback.provider === 'youtube' ? 'block' : 'none' }}
        >
          <h2 className="side__heading">Now playing</h2>
          <div className="ytplayer" ref={youtubeRef} />
          <p className="hint" style={{ marginTop: 6 }}>
            The video plays here and stays yours to control.
          </p>
        </div>

        <div className="card">
          <h2 className="side__heading">You</h2>
          <input
            value={name}
            placeholder="your name"
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <span className="row__label">room</span>
            <span className="row__value mono">{roomId}</span>
          </div>
          <div className="row">
            <span className="row__label">connection</span>
            <span
              className="row__value mono"
              style={{ color: room.connection === 'open' ? 'var(--green)' : 'var(--muted)' }}
            >
              {room.connection}
            </span>
          </div>
          {room.connection !== 'open' && (
            <p className="hint" style={{ marginTop: 6 }}>
              Playing solo. Run <code>npm run serve</code> and open the address it prints
              to play with other people.
            </p>
          )}
        </div>

        <div className="card">
          <h2 className="side__heading">Timing</h2>
          <div className="row">
            <span className="row__label">offset</span>
            <span className="row__value mono">{offsetMs > 0 ? '+' : ''}{offsetMs} ms</span>
          </div>
          <input
            type="range"
            min={-150}
            max={150}
            step={1}
            value={offsetMs}
            onChange={(e) => applyOffset(Number(e.target.value))}
          />
          <p className="hint" style={{ marginTop: 6 }}>
            Raise it if you keep hitting early, lower it if you keep hitting late.
            Finish a song and it will offer the exact number.
          </p>
        </div>

        <div className="card">
          <h2 className="side__heading">Room</h2>
          {room.room && room.room.players.length > 0 ? (
            <div className="board">
              {room.room.players.map((player) => (
                <div
                  key={player.id}
                  className={`board__row ${player.id === room.playerId ? 'board__row--me' : ''}`}
                >
                  <span className="board__rank mono">{player.rank}</span>
                  <span className="board__name">{player.name}</span>
                  <span className="mono">{player.score.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">Nobody else here yet.</p>
          )}
        </div>

        <div className="card">
          <h2 className="side__heading">Chat</h2>
          <div className="chat">
            {room.chat.length === 0 && <p className="hint">Say hello.</p>}
            {room.chat.map((line) => (
              <div key={line.id} className={line.system ? 'chat__line--system' : ''}>
                {line.from && <span className="chat__from">{line.from}: </span>}
                {line.text}
              </div>
            ))}
          </div>
          <form
            className="chat__form"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              room.send(C2S.CHAT, { text });
              setDraft('');
            }}
          >
            <input
              value={draft}
              placeholder="message"
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" disabled={room.connection !== 'open'}>Send</button>
          </form>
        </div>
      </aside>
    </div>
  );
}
