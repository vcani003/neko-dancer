/**
 * The existing playfield, fed a session. Not a second set of lanes.
 *
 * `LaneRenderer` draws the room, the chevrons, the TV and the wander.
 * This file only owns the loop: load, countdown, press, results.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EngineState } from '@neko/game-core';
import {
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
import type { HttpCatalog } from '../../play/HttpCatalog.ts';
import { PlaySession, type PlayPhase } from '../../play/PlaySession.ts';
import { videoClicksAllowed } from '../shared/roomTheme.ts';

export interface StageSnapshot {
  phase: PlayPhase;
  countdownMs: number;
  progress: EngineState | null;
  result: RoundResult | null;
  chart: PlayableChart | null;
  spectating: boolean;
}

export interface PlayRequest {
  revisionId: RevisionId;
  gen: number;
  countdownMs?: number;
  spectate?: boolean;
  elapsedMs?: number;
}

interface StageProps {
  catalog: HttpCatalog;
  user: User | null;
  kind: DancerKind;
  players?: RoomPlayerView[];
  play: PlayRequest | null;
  waiting?: ReactNode;
  resultsExtra?: ReactNode;
  onFinished?: (result: RoundResult) => void;
  /** Staging (and `?dev=1`) leave the YouTube pause button usable. */
  allowVideoClicks?: boolean;
}

interface HeldResult {
  result: RoundResult | null;
  spectating: boolean;
  grade: string | null;
}

export function Stage({
  catalog,
  user,
  kind,
  players,
  play,
  waiting,
  resultsExtra,
  onFinished,
  allowVideoClicks = false,
}: StageProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const youtubeRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LaneRenderer | null>(null);
  const sessionRef = useRef<PlaySession | null>(null);
  const adapterRef = useRef<PlaybackAdapter | null>(null);
  const inputRef = useRef<KeyboardInput | null>(null);
  const rafRef = useRef(0);
  const savedRef = useRef(false);
  const finishedRef = useRef(false);
  const userRef = useRef<User | null>(user);
  const kindRef = useRef<DancerKind>(kind);
  const playersRef = useRef<RoomPlayerView[] | undefined>(players);
  const onFinishedRef = useRef(onFinished);

  const unlockVideo = useRef(allowVideoClicks || videoClicksAllowed());
  const heldRef = useRef<HeldResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [heldResult, setHeldResult] = useState<HeldResult | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);
  useEffect(() => {
    kindRef.current = kind;
  }, [kind]);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);
  useEffect(() => {
    unlockVideo.current = allowVideoClicks || videoClicksAllowed();
  }, [allowVideoClicks]);

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
        const session = sessionRef.current;
        if (session?.isSpectating()) return;
        const now = performance.now();
        rendererRef.current?.reactToPress(lane, now);
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
        const result = session.result();
        setSnapshot({
          phase,
          countdownMs: session.countdownRemainingMs(now),
          progress: session.progress(),
          result,
          chart: session.playable(),
          spectating: session.isSpectating(),
        });
        if (
          phase === 'playing' &&
          !unlockVideo.current &&
          adapterRef.current?.state() === 'paused'
        ) {
          adapterRef.current.play();
        }
        if (phase === 'playing' && heldRef.current) {
          heldRef.current = null;
          setHeldResult(null);
        }
        if (phase === 'finished' && !finishedRef.current) {
          finishedRef.current = true;
          const held: HeldResult = {
            result,
            spectating: session.isSpectating(),
            grade: session.progress()?.grade ?? null,
          };
          heldRef.current = held;
          setHeldResult(held);
          if (!session.isSpectating()) {
            const who = userRef.current;
            if (who && result && !savedRef.current) {
              savedRef.current = true;
              void session.saveResult(who.id);
            }
            onFinishedRef.current?.(
              result ?? {
                score: 0,
                combo: 0,
                accuracy: 0,
                health: 100,
                maxCombo: 0,
                counts: { PERFECT: 0, GREAT: 0, GOOD: 0, OKAY: 0, MISS: 0 },
                completed: true,
              },
            );
          }
        }
      }

      const who = userRef.current;
      const mine: RoomPlayerView = {
        id: who?.id ?? 'me',
        name: who?.displayName ?? 'neko',
        isMe: true,
        kind: kindRef.current,
      };
      const cast = playersRef.current?.length ? playersRef.current : [mine];

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
        players: cast,
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
    finishedRef.current = false;
    youtubeRef.current?.replaceChildren();
    rendererRef.current?.clearEffects();
    setSnapshot(null);
    setProvider(null);
  }

  function dropHeld(): void {
    heldRef.current = null;
    setHeldResult(null);
  }

  useEffect(() => {
    if (!play) {
      disposeRun();
      dropHeld();
      setBusy(false);
      return;
    }
    let cancelled = false;
    const receivedAt = performance.now();
    void (async () => {
      disposeRun();
      setError(null);
      setBusy(true);
      try {
        const chart = await catalog.getPlayable(play.revisionId);
        if (!chart) throw new Error('No such chart.');
        if (cancelled) return;
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
        const session = new PlaySession({
          catalog,
          adapter,
          countdownMs: play.countdownMs,
        });
        sessionRef.current = session;
        await session.choose(play.revisionId);
        if (cancelled) return;
        if (play.spectate) {
          const drift = performance.now() - receivedAt;
          session.beginSpectate((play.elapsedMs ?? 0) + drift);
        } else {
          session.beginCountdown(performance.now());
        }
      } catch (err) {
        if (!cancelled) {
          disposeRun();
          setError(err instanceof Error ? err.message : 'Could not start that chart.');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, play]);

  const youtubeLive = provider === 'youtube';
  const countdownSec = snapshot ? Math.ceil(snapshot.countdownMs / 1000) : 0;
  const resultGrade = heldResult?.grade ?? snapshot?.progress?.grade;
  const health = snapshot?.progress?.health ?? 100;
  const active = snapshot && snapshot.phase !== 'idle' && snapshot.phase !== 'finished';
  const lockVideo = !unlockVideo.current;
  const shieldUp =
    lockVideo &&
    Boolean(play) &&
    snapshot?.phase !== 'idle';
  const showCountdown = snapshot?.phase === 'countdown' && countdownSec > 0;
  const showLaneCard = Boolean(heldResult) || showCountdown || busy;

  return (
    <div className="play">
      <div className="field" ref={fieldRef}>
        <div className="tv" style={{ display: youtubeLive ? 'block' : 'none' }}>
          <div className="tv__screen" ref={youtubeRef} />
          {shieldUp && <div className="tv__shield" aria-hidden="true" />}
          <div className="tv__stand" />
        </div>

        {active && !snapshot?.spectating && (
          <div className="hud">
            <div className="hud__col">
              <div className="hud__label">Score</div>
              <div className="hud__score mono">{snapshot?.progress?.score ?? 0}</div>
            </div>
            <div className="hud__col">
              <div className="hud__label">Combo</div>
              <div
                className="hud__combo mono"
                data-live={snapshot?.progress?.combo ? '' : undefined}
              >
                {snapshot?.progress?.combo ?? 0}
              </div>
            </div>
            <div className="hud__col">
              <div className="hud__label">Accuracy</div>
              <div className="hud__accuracy mono">
                {snapshot?.progress ? `${Math.round(snapshot.progress.accuracy * 100)}%` : '—'}
              </div>
              <div className="hud__grade">{snapshot?.progress?.grade ?? '—'}</div>
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
        )}

        {snapshot?.chart && (
          <div className="nowplaying">
            {snapshot.spectating || heldResult?.spectating ? 'Spectating · ' : ''}
            {snapshot.chart.song.title}
            {snapshot.chart.song.artist ? ` · ${snapshot.chart.song.artist}` : ''}
          </div>
        )}

        {snapshot?.spectating && snapshot.phase === 'playing' && (
          <div className="spectate">You joined mid-song. Next one you can play.</div>
        )}

        {error && (
          <div className="readybar">
            <div className="error">{error}</div>
          </div>
        )}

        {showLaneCard && (
          <div className="lane-card">
            {showCountdown && <div className="lane-card__count mono">{countdownSec}</div>}
            {busy && !showCountdown && <div className="lane-card__load">Loading…</div>}
            {heldResult && !heldResult.spectating && heldResult.result && (
              <>
                <div className="results__grade">{resultGrade ?? '—'}</div>
                <div className="results__grid">
                  <div>
                    <div className="results__k">Score</div>
                    <div className="results__v">{heldResult.result.score}</div>
                  </div>
                  <div>
                    <div className="results__k">Accuracy</div>
                    <div className="results__v">{Math.round(heldResult.result.accuracy * 100)}%</div>
                  </div>
                  <div>
                    <div className="results__k">Max combo</div>
                    <div className="results__v">{heldResult.result.maxCombo}</div>
                  </div>
                  <div>
                    <div className="results__k">Perfect</div>
                    <div className="results__v">{heldResult.result.counts.PERFECT}</div>
                  </div>
                  <div>
                    <div className="results__k">Great</div>
                    <div className="results__v">{heldResult.result.counts.GREAT}</div>
                  </div>
                  <div>
                    <div className="results__k">Miss</div>
                    <div className="results__v">{heldResult.result.counts.MISS}</div>
                  </div>
                </div>
              </>
            )}
            {heldResult?.spectating && (
              <p className="hint">You were watching. Next chart you can play.</p>
            )}
            {heldResult && resultsExtra}
          </div>
        )}

        {(!snapshot || snapshot.phase === 'idle') && !busy && !heldResult && waiting}
      </div>
    </div>
  );
}
