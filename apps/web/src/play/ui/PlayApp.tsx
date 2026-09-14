/**
 * The Phase 4 play page, on the existing stage.
 *
 * `LaneRenderer` already draws the room, the chevron arrows, the TV and
 * the wander. This file only feeds it a `PlaySession` and a dance sheet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineState } from '@neko/game-core';
import {
  type BeatmapSummary,
  type Lane as ProtocolLane,
  type PlayableChart,
  type RevisionId,
  type RoundResult,
  type User,
} from '@neko/protocol';
import type { PlaybackAdapter } from '../../playback/PlaybackAdapter.ts';
import { RealtimeAdapter } from '../../playback/RealtimeAdapter.ts';
import { YouTubeAdapter } from '../../playback/YouTubeAdapter.ts';
import { KeyboardInput } from '../../../../../src/input/KeyboardInput.ts';
import {
  DEFAULT_LEAD_MS,
  LaneRenderer,
  type RoomPlayerView,
} from '../../../../../src/render/LaneRenderer.ts';
import type { DancerKind } from '../../../../../src/render/SpriteDancer.ts';
import type { Lane } from '../../../../../src/charts/schema.ts';
import { HttpCatalog } from '../HttpCatalog.ts';
import { PlaySession, type PlayPhase } from '../PlaySession.ts';

interface Snapshot {
  phase: PlayPhase;
  countdownMs: number;
  progress: EngineState | null;
  result: RoundResult | null;
  chart: PlayableChart | null;
}

export function PlayApp() {
  const catalog = useMemo(() => new HttpCatalog(), []);
  const fieldRef = useRef<HTMLDivElement>(null);
  const youtubeRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LaneRenderer | null>(null);
  const sessionRef = useRef<PlaySession | null>(null);
  const adapterRef = useRef<PlaybackAdapter | null>(null);
  const inputRef = useRef<KeyboardInput | null>(null);
  const rafRef = useRef(0);
  const savedRef = useRef(false);
  const userRef = useRef<User | null>(null);
  const kindRef = useRef<DancerKind>('cat');
  const screenRef = useRef<'library' | 'play'>('library');

  const [user, setUser] = useState<User | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [library, setLibrary] = useState<BeatmapSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [screen, setScreen] = useState<'library' | 'play'>('library');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [kind, setKind] = useState<DancerKind>('cat');

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    kindRef.current = kind;
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await catalog.me();
        const listed = await catalog.listPublished();
        if (cancelled) return;
        setUser(me);
        setNameDraft(me.displayName);
        setLibrary(listed);
      } catch {
        if (!cancelled) {
          setError('The store is not running. In another terminal, from this repo: npm run api');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  useEffect(() => {
    let cancelled = false;
    const renderer = new LaneRenderer();
    const field = fieldRef.current;
    if (!field) return;
    renderer
      .init(field)
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

  useEffect(() => {
    const input = new KeyboardInput({
      onPress: ({ lane }) => {
        const now = performance.now();
        rendererRef.current?.reactToPress(lane, now);
        const session = sessionRef.current;
        if (!session || session.currentPhase() !== 'playing') return;
        const hit = session.press(lane as ProtocolLane);
        if (hit) rendererRef.current?.showJudgment(hit.judgment, lane, now);
      },
    });
    input.attach();
    inputRef.current = input;
    return () => {
      input.detach();
      inputRef.current = null;
    };
  }, []);

  useEffect(() => {
    const step = (now: number) => {
      const session = sessionRef.current;
      if (session) {
        session.tick(now);
        const phase = session.currentPhase();
        setSnapshot({
          phase,
          countdownMs: session.countdownRemainingMs(now),
          progress: session.progress(),
          result: session.result(),
          chart: session.playable(),
        });
        if (phase === 'finished' && !savedRef.current) {
          const who = userRef.current;
          if (who) {
            savedRef.current = true;
            void session.saveResult(who.id);
          }
        }
      }

      const who = userRef.current;
      const player: RoomPlayerView = {
        id: who?.id ?? 'me',
        name: who?.displayName ?? 'neko',
        isMe: true,
        kind: kindRef.current,
      };

      rendererRef.current?.render({
        arrows: (session?.visible(DEFAULT_LEAD_MS) ?? []).map((active) => ({
          timeMs: active.note.timeMs,
          judgment: active.judgment,
          arrow: { lane: active.note.lane as Lane },
        })),
        playbackTimeMs: session?.adapter.currentTimeMs() ?? 0,
        heldLanes: inputRef.current?.heldLanes() ?? new Set<Lane>(),
        leadMs: DEFAULT_LEAD_MS,
        nowMs: now,
        bpm: session?.playable()?.revision.timing[0]?.bpm ?? 0,
        players: [player],
        roundRunning: session?.currentPhase() === 'playing',
      });

      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function disposeRun(): void {
    adapterRef.current?.dispose();
    adapterRef.current = null;
    sessionRef.current = null;
    savedRef.current = false;
    youtubeRef.current?.replaceChildren();
    rendererRef.current?.clearEffects();
    setSnapshot(null);
    setProvider(null);
  }

  async function play(revisionId: RevisionId): Promise<void> {
    disposeRun();
    setError(null);
    setBusy(true);
    setScreen('play');
    try {
      const chart = await catalog.getPlayable(revisionId);
      if (!chart) throw new Error('No such chart.');
      setProvider(chart.song.provider);
      if (chart.song.provider === 'youtube') {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const box = youtubeRef.current;
      if (!box) throw new Error('The player mount is missing.');
      const adapter =
        chart.song.provider === 'youtube'
          ? new YouTubeAdapter({
              container: box,
              onLateError: (err) => setError(err.message),
            })
          : new RealtimeAdapter({ now: () => performance.now(), durationMs: chart.song.durationMs });
      adapterRef.current = adapter;
      const session = new PlaySession({ catalog, adapter });
      sessionRef.current = session;
      await session.choose(revisionId);
      session.beginCountdown(performance.now());
    } catch (err) {
      disposeRun();
      setScreen('library');
      setError(err instanceof Error ? err.message : 'Could not start that chart.');
    } finally {
      setBusy(false);
    }
  }

  async function saveName(): Promise<void> {
    if (!user || nameDraft === user.displayName) return;
    try {
      const next = await catalog.rename(nameDraft);
      setUser(next);
      setNameDraft(next.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that name.');
    }
  }

  const youtubeLive = provider === 'youtube';
  const countdownSec = snapshot ? Math.ceil(snapshot.countdownMs / 1000) : 0;
  const resultGrade = snapshot?.progress?.grade;
  const health = snapshot?.progress?.health ?? 100;

  return (
    <div className="play">
      <div className="field" ref={fieldRef}>
        <div className="tv" style={{ display: youtubeLive ? 'block' : 'none' }}>
          <div className="tv__screen" ref={youtubeRef} />
          <div className="tv__stand" />
        </div>

        {screen === 'play' && (
          <>
            <div className="hud">
              <div>
                <div className="hud__score mono">{snapshot?.progress?.score ?? 0}</div>
                {!!snapshot?.progress?.combo && (
                  <div className="hud__combo mono">{snapshot.progress.combo} combo</div>
                )}
              </div>
              <div className="hud__right">
                <div className="hud__accuracy mono">
                  {snapshot?.progress
                    ? `${Math.round(snapshot.progress.accuracy * 100)}% · ${snapshot.progress.grade}`
                    : '—'}
                </div>
                <div className="health">
                  <div
                    className="health__fill"
                    style={{
                      width: `${health}%`,
                      background: health > 30 ? 'var(--green)' : 'var(--bad)',
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {screen === 'library' && (
          <div className="overlay">
            <div className="panel">
              <h1>
                neko <span>dancer</span>
              </h1>
              <p className="hint">
                Published charts from the store. Arrows or WASD. Open as{' '}
                <code>http://&lt;hostname&gt;.local:5180/play.html</code>.
              </p>
              {user && (
                <form
                  className="who"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveName();
                  }}
                >
                  <label htmlFor="display-name">playing as</label>
                  <input
                    id="display-name"
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={() => void saveName()}
                  />
                </form>
              )}
              <div className="cast__buttons">
                <button
                  type="button"
                  className={kind === 'cat' ? 'is-active' : undefined}
                  onClick={() => setKind('cat')}
                >
                  Cat
                </button>
                <button
                  type="button"
                  className={kind === 'bunny' ? 'is-active' : undefined}
                  onClick={() => setKind('bunny')}
                >
                  Bunny
                </button>
              </div>
              {error && <div className="error">{error}</div>}
              <div className="songlist">
                {busy && library.length === 0 && <p className="hint">Loading the library…</p>}
                {library.map((row) => (
                  <button
                    key={row.revisionId}
                    type="button"
                    className="songrow"
                    disabled={busy}
                    onClick={() => void play(row.revisionId)}
                  >
                    <span>
                      <span className="songrow__title">{row.title}</span>
                      <br />
                      <span className="songrow__meta">
                        {row.artist} · {row.difficulty} · {row.noteCount} notes · {row.authorName}
                      </span>
                    </span>
                    Play
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {busy && screen === 'play' && (
          <div className="overlay">
            <div className="panel">
              <h2>Loading…</h2>
            </div>
          </div>
        )}

        {snapshot?.phase === 'countdown' && countdownSec > 0 && (
          <div className="overlay">
            <div className="panel">
              <h1>{countdownSec}</h1>
            </div>
          </div>
        )}

        {snapshot?.phase === 'finished' && snapshot.result && (
          <div className="overlay">
            <div className="panel">
              <div className="results__grade">{resultGrade ?? '—'}</div>
              <div className="results__grid">
                <div>
                  <div className="results__k">Score</div>
                  <div className="results__v">{snapshot.result.score}</div>
                </div>
                <div>
                  <div className="results__k">Accuracy</div>
                  <div className="results__v">{Math.round(snapshot.result.accuracy * 100)}%</div>
                </div>
                <div>
                  <div className="results__k">Max combo</div>
                  <div className="results__v">{snapshot.result.maxCombo}</div>
                </div>
                <div>
                  <div className="results__k">Perfect</div>
                  <div className="results__v">{snapshot.result.counts.PERFECT}</div>
                </div>
                <div>
                  <div className="results__k">Great</div>
                  <div className="results__v">{snapshot.result.counts.GREAT}</div>
                </div>
                <div>
                  <div className="results__k">Miss</div>
                  <div className="results__v">{snapshot.result.counts.MISS}</div>
                </div>
              </div>
              <button
                type="button"
                className="button--primary"
                onClick={() => {
                  disposeRun();
                  setScreen('library');
                }}
              >
                Back to library
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
