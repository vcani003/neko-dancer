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
import { chartDurationMs, LANES, type Chart, type Lane } from './charts/schema.ts';
import { TUTORIAL_CHART } from './charts/library.ts';
import { ClickTrackAdapter } from './playback/ClickTrackAdapter.ts';
import { YouTubeAdapter } from './playback/YouTubeAdapter.ts';
import type { PlaybackAdapter } from './playback/PlaybackAdapter.ts';
import {
  LocalChartStore,
  builtInRecord,
  receivedRecord,
  songKey,
  type StoredChart,
} from './charts/ChartStore.ts';
import { validateChart } from './charts/validator.ts';
import { YouTubePlaybackError, checkVideoPlayable } from './playback/YouTubeAdapter.ts';
import AddSong from './ui/AddSong.tsx';
import SectionEditor from './ui/SectionEditor.tsx';
import { flatPlan, type SongPlan } from './charts/SongPlan.ts';
import { analysisFromTempo } from './analysis/fromTempo.ts';
import { generateChart } from './analysis/generate.ts';
import { KeyboardInput } from './input/KeyboardInput.ts';
import { DEFAULT_LEAD_MS, LaneRenderer, type RoomPlayerView } from './render/LaneRenderer.ts';
import { C2S, useRoom } from './net/useRoom.ts';

type Phase = 'menu' | 'adding' | 'editing' | 'playing' | 'results';

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

/**
 * Are these the same beatmap?
 *
 * Compared by content rather than by identity, because the same chart reaches
 * this browser under different names — shipped with the game, sent by the
 * room, saved locally after a round — and three rows for one song is worse
 * than the cost of stringifying twenty kilobytes once per pick.
 */
function sameChart(a: Chart, b: Chart): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Which of the room's fixed explanations fits this failure.
 *
 * A code, never a sentence: the room announces it as a system message, and the
 * wording belongs to the server so that no client can put official-looking
 * text in everyone's chat.
 */
function troubleReason(error: YouTubePlaybackError | null): string {
  switch (error?.code) {
    case 101:
    case 150:
      return 'embedBlocked';
    case 100:
      return 'unavailable';
    case 5:
      return 'playerFailed';
    case 2:
      return 'badId';
    default:
      return 'unknown';
  }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('menu');
  const [hud, setHud] = useState<HudView>(EMPTY_HUD);
  const [error, setError] = useState<string | null>(null);
  /** What to try next. Separate from the error so it can be worded as advice. */
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  /**
   * Who is in the room, for the renderer.
   *
   * Mirrored into a ref because the draw loop needs it every frame and must
   * not read React state from inside requestAnimationFrame. Falls back to a
   * single local cat, so the room is never empty just because the server is
   * unreachable.
   */
  const playersRef = useRef<RoomPlayerView[]>([]);
  const [countdownLeft, setCountdownLeft] = useState(0);
  // The round effect is declared above `start`; a ref bridges the ordering.
  const startRef = useRef<() => Promise<void>>(async () => {});

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
  const tutorial = useMemo(() => builtInRecord(TUTORIAL_CHART), []);
  const [selectedId, setSelectedId] = useState<string>(tutorial.id);

  const refreshCharts = useCallback(() => {
    void store.list().then(setSaved);
  }, [store]);
  useEffect(refreshCharts, [refreshCharts]);

  /**
   * The built-in chart first, then everything saved here.
   *
   * De-duplicated by id, because a chart can arrive from two directions at
   * once: shipped with the game and saved locally after the room played it.
   * Without this the tutorial appears twice the moment anyone picks it.
   */
  const allCharts = useMemo(() => {
    const byId = new Map<string, StoredChart>();
    for (const record of [tutorial, ...saved]) {
      if (!byId.has(record.id)) byId.set(record.id, record);
    }
    return [...byId.values()];
  }, [saved, tutorial]);
  /**
   * The room's song, which wins over any local selection while connected.
   *
   * The room is the distribution mechanism: whoever picks sends their chart
   * with it, so someone who has never charted this song can still play it.
   * Charts are small JSON, which is what makes that free.
   */
  const [roomChart, setRoomChart] = useState<StoredChart | null>(null);

  /**
   * Take the room's song — after checking it.
   *
   * This chart came from another player over the network, so it is data and
   * not a promise. It drives the engine and the renderer, and an arrow with a
   * missing lane or a NaN time would break both. Validating here means a bad
   * chart is refused at the door rather than found mid-song.
   *
   * Accepted charts are also saved locally, so a song someone else charted is
   * yours to replay afterwards.
   */
  const acceptRoomChart = useCallback(
    (incoming: unknown, authoredBy?: string) => {
      const check = validateChart(incoming);
      if (!check.ok) {
        // Loudly, because the alternative is a player pressing ready against a
        // song that silently never arrived.
        setError(`That song could not be loaded: ${check.errors[0]}`);
        setErrorHint('Ask whoever picked it to add it again.');
        return;
      }
      const next = incoming as Chart;
      // Don't keep a second copy of something already held. The room re-sends
      // its chart on every pick, and before charts had identities that meant
      // the built-in tutorial got saved back as a duplicate of itself the
      // first time anyone played it.
      const identical = allCharts.find(
        (held) => held.songKey === songKey(next) && sameChart(held.chart, next),
      );
      if (identical) {
        setRoomChart(identical);
        setSelectedId(identical.id);
        return;
      }
      const record = receivedRecord(next, authoredBy);
      setRoomChart(record);
      setSelectedId(record.id);
      void store.save(record).then(refreshCharts).catch(() => {});
    },
    [store, refreshCharts, allCharts],
  );

  const active = useMemo(
    () => roomChart ?? allCharts.find((s) => s.id === selectedId) ?? tutorial,
    [roomChart, allCharts, selectedId, tutorial],
  );
  const chart = active.chart;

  /** Whatever is actually loaded, however it got here. */
  const activeKey = active.id;

  /**
   * The list to show. Normally just what this browser holds — but a chart the
   * room sent belongs in it immediately, without waiting on the save that
   * follows, and whether or not that save succeeds.
   */
  const songChoices = useMemo(() => {
    if (!roomChart || allCharts.some((s) => s.id === activeKey)) return allCharts;
    return [roomChart, ...allCharts];
  }, [roomChart, allCharts, activeKey]);

  /**
   * Admin unlocks editing a song's shape.
   *
   * Gated because a plan belongs to the SONG rather than to a player: everyone
   * in a room plays the same chart, so editing one edits it for everybody.
   */
  const isAdmin = useMemo(
    () =>
      new URLSearchParams(window.location.search).get('admin') === '1' ||
      localStorage.getItem('neko.admin') === '1',
    [],
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
          bpm: chart.analysis.bpm,
          players: playersRef.current,
          roundRunning: phaseRef.current === 'playing',
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

  /**
   * Follow the room: take the chart it sent, count down, and start.
   *
   * The countdown is measured from when the signal ARRIVED here rather than
   * from when this effect runs, so a slow render does not make one player
   * start late. Everyone is counting the same duration from within a
   * millisecond or two of each other on a local network.
   */
  useEffect(() => {
    const signal = room.signal;
    if (!signal) return;

    if (signal.round.state === 'countdown') {
      if (signal.chart) acceptRoomChart(signal.chart);
      const elapsed = performance.now() - signal.receivedAtMs;
      const remaining = Math.max(0, (signal.round.countdownMs ?? 3000) - elapsed);
      setCountdownEndsAt(performance.now() + remaining);
      return;
    }

    if (signal.round.state === 'playing') {
      setCountdownEndsAt(null);
      void startRef.current();
      return;
    }

    if (signal.round.state === 'results') {
      setCountdownEndsAt(null);
    }
  }, [room.signal, acceptRoomChart]);

  /**
   * Tell the room what this browser is called, when that changes.
   *
   * The name used to be sent once, at JOIN, so editing the box after
   * connecting changed nothing anyone else could see — two windows both showed
   * as "neko" and there was no way to tell whose ready was whose. Debounced,
   * because this fires on every keystroke.
   */
  useEffect(() => {
    if (room.connection !== 'open' || !room.playerId) return;
    const id = window.setTimeout(() => {
      room.send(C2S.RENAME, { name: name || 'neko' });
    }, 400);
    return () => window.clearTimeout(id);
  }, [name, room.connection, room.playerId, room.send]);

  /**
   * Find out whether the room's song plays HERE, before anyone counts down.
   *
   * Embedding, region and age restrictions differ per viewer, so this is a
   * question only this browser can answer. Asking it in the lobby turns "the
   * video was unavailable" three seconds into a countdown into a line in the
   * player list that everybody can see and act on.
   */
  const roomSongId = room.room?.song?.id ?? null;
  const roomVideoId =
    chart.song.playback.provider === 'youtube' ? chart.song.playback.videoId : null;
  useEffect(() => {
    if (!roomSongId || !roomVideoId || room.connection !== 'open') return;
    let cancelled = false;
    void checkVideoPlayable(roomVideoId).then((result) => {
      // The room may have moved on to a different song while this was running;
      // the songId sent with the answer is what lets the server ignore a late
      // reply about a song nobody is on any more.
      if (cancelled) return;
      room.send(C2S.CAN_PLAY, {
        songId: roomSongId,
        ok: result.ok,
        reason: troubleReason(result.error ?? null),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [roomSongId, roomVideoId, room.connection, room.send]);

  /**
   * The room picked a song. Everyone plays it, including whoever has never
   * heard of it — the chart travels with the pick.
   */
  useEffect(() => {
    if (!room.song) return;
    acceptRoomChart(room.song.chart, room.song.pickedBy ?? undefined);
  }, [room.song, acceptRoomChart]);

  /**
   * Report a failure to the player, and to the room.
   *
   * The room half matters as much as the message: when one person's video will
   * not load, everyone else is left waiting on a player who is never going to
   * start. Saying so ends the round instead of hanging it.
   */
  const reportFailure = useCallback(
    (err: unknown, fallback: string) => {
      const known = err instanceof YouTubePlaybackError ? err : null;
      setError(known?.message ?? (err instanceof Error ? err.message : fallback));
      setErrorHint(known?.hint ?? null);
      // Sent whatever the cause, and whether or not it was YouTube that named
      // it. Knowing WHY is a refinement; knowing that someone is not going to
      // start is what stops the rest of the room waiting on them.
      room.send(C2S.TROUBLE, { reason: troubleReason(known) });
    },
    [room.send],
  );

  const start = useCallback(async () => {
    setError(null);
    setErrorHint(null);
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
          // A video that dies part-way through would otherwise just stop the
          // clock, leaving a chart frozen on screen with no explanation.
          onLateError: (err) => {
            reportFailure(err, 'The video stopped.');
            setPhase('menu');
          },
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
      reportFailure(err, 'That song could not be loaded.');
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
      setPhase('playing');
    } catch (err) {
      reportFailure(err, 'Could not start audio.');
      setPhase('menu');
    }
  }, [chart, offsetMs, reportFailure]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  /** Tick the visible countdown. Purely cosmetic; the start is already scheduled. */
  useEffect(() => {
    if (countdownEndsAt === null) return;
    const id = window.setInterval(() => {
      setCountdownLeft(Math.max(0, countdownEndsAt - performance.now()));
    }, 60);
    return () => window.clearInterval(id);
  }, [countdownEndsAt]);

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

  const me = room.room?.players.find((p) => p.id === room.playerId);
  // Players the song will not load for are not waited on — they are sitting
  // this round out, and counting them would mean one restricted video stops
  // everybody.
  const waitingOn =
    room.room && room.room.players.length > 1 && room.room.round.state === 'lobby'
      ? room.room.players
          .filter((p) => !p.ready && p.canPlay !== 'no')
          .map((p) => (p.id === room.playerId ? `${p.name} (you)` : p.name))
      : [];
  const sittingOut = room.room?.players.filter((p) => p.canPlay === 'no') ?? [];
  const iCannotPlay = me?.canPlay === 'no';

  useEffect(() => {
    const roster = room.room?.players ?? [];
    playersRef.current =
      roster.length > 0
        ? roster.map((p) => ({ id: p.id, name: p.name, isMe: p.id === room.playerId }))
        : [{ id: 'me', name: name || 'you', isMe: true }];
  }, [room.room, room.playerId, name]);
  const score = hud.score;
  const live = phase === 'playing';
  const progress = hud.durationMs > 0 ? Math.min(1, Math.max(0, hud.playbackTimeMs / hud.durationMs)) : 0;
  const healthColour =
    score.health > 60 ? 'var(--green)' : score.health > 25 ? 'var(--gold)' : 'var(--bad)';

  return (
    <div className="app">
      <div className="field" ref={stageRef}>
        {/*
          The video hangs on the back wall like a screen in the room, which is
          both how the original reads and how YouTube requires it: visible and
          working, never hidden behind the game.
        */}
        <div
          className="tv"
          style={{ display: chart.song.playback.provider === 'youtube' ? 'block' : 'none' }}
        >
          <div className="tv__screen" ref={youtubeRef} />
          <div className="tv__stand" />
        </div>

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
              <p className="hint">
                {chart.song.title} · {chart.arrows.length} arrows
                {room.room?.song?.pickedBy ? ` · picked by ${room.room.song.pickedBy}` : ''}
              </p>

              <div className="songlist">
                {songChoices.map((record) => {
                  const c = record.chart;
                  return (
                    <button
                      key={record.id}
                      className={`songrow ${record.id === activeKey ? 'is-active' : ''}`}
                      onClick={() => {
                        // Clear first so the click feels instant; if we are in
                        // a room the server echoes the pick straight back and
                        // sets it again, for everyone at once.
                        setRoomChart(null);
                        setSelectedId(record.id);
                        // Picking is its own action, deliberately not bundled
                        // into "I'm ready". Picking un-readies the room — so
                        // when the two were one button, every player who
                        // readied wiped out everyone before them and the
                        // countdown could never fire.
                        if (room.connection === 'open') room.send(C2S.PICK_SONG, { chart: c });
                      }}
                    >
                      <span>
                        <span className="songrow__title">{c.song.title}</span>
                        <br />
                        <span className="songrow__meta">
                          {c.arrows.length} arrows · {c.analysis.bpm.toFixed(0)} BPM ·{' '}
                          {c.source === 'generated' ? 'tapped' : 'hand-written'}
                          {record.author !== 'built-in' && ` · v${record.version}`}
                          {record.author !== 'built-in' && record.authoredBy
                            ? ` · by ${record.authoredBy}`
                            : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <button onClick={() => setPhase('adding')}>Add a song from YouTube</button>

              {isAdmin && (
                <button onClick={() => setPhase('editing')}>
                  Edit this song's shape
                </button>
              )}

              {room.connection === 'open' && room.room && (
                <div className="readybar">
                  <span className="readybar__count mono">
                    {room.room.players.filter((p) => p.ready).length} /{' '}
                    {room.room.players.filter((p) => p.canPlay !== 'no').length} ready
                  </span>
                  <button
                    className={me?.ready ? '' : 'button--primary'}
                    disabled={iCannotPlay}
                    onClick={() => room.send(C2S.READY, { ready: !me?.ready })}
                  >
                    {iCannotPlay ? 'Cannot play this' : me?.ready ? 'Not ready' : "I'm ready"}
                  </button>
                </div>
              )}

              {room.connection === 'open' && (room.room?.players.length ?? 0) < 2 && (
                <p className="hint" style={{ fontSize: '0.72rem' }}>
                  Waiting for someone to join. Everyone hits ready, then the song starts
                  for all of you at once.
                </p>
              )}

              {/* Naming who is holding things up. Every open tab is a player,
                  so "2 / 3 ready" is a mystery until you can see that the
                  third one is a window you forgot about. */}
              {waitingOn.length > 0 && (
                <p className="hint" style={{ fontSize: '0.72rem' }}>
                  Waiting on {waitingOn.join(', ')}.
                </p>
              )}

              {sittingOut.length > 0 && (
                <p className="hint" style={{ fontSize: '0.72rem', color: 'var(--bad)' }}>
                  {sittingOut.map((p) => p.name).join(', ')}{' '}
                  {sittingOut.length === 1 ? 'cannot' : 'cannot'} play this video and will sit
                  this round out. {sittingOut[0]?.cannotPlayReason}
                </p>
              )}

              <div className="keycaps">
                {LANES.map((lane) => (
                  <span key={lane} className="keycap">{ARROW_GLYPH[lane]}</span>
                ))}
              </div>
              <p className="hint">
                Hit the arrow key as its arrow reaches the line. Arrow keys or WASD.
                Missing drains your health — run out and the song ends.
              </p>

              {error && (
                <>
                  <p className="hint" style={{ color: 'var(--bad)' }}>{error}</p>
                  {errorHint && <p className="hint">{errorHint}</p>}
                </>
              )}
              <button className="button--primary" onClick={start}>Play</button>
            </div>
          </div>
        )}

        {countdownEndsAt !== null && phase !== 'playing' && (
          <div className="overlay">
            <div className="panel">
              <p className="hint">Everyone is ready</p>
              <div className="countdown mono">{Math.ceil(countdownLeft / 1000)}</div>
              <p className="hint">{chart.song.title}</p>
              <div className="keycaps">
                {LANES.map((lane) => (
                  <span key={lane} className="keycap">{ARROW_GLYPH[lane]}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {phase === 'adding' && (
          <div className="overlay">
            <AddSong
              onCancel={() => setPhase('menu')}
              onCharted={(newChart) => {
                // `add` rather than `save`: a re-tap of a song you already
                // charted becomes your v2 instead of destroying your v1.
                void store.add(newChart, name || undefined).then((stored) => {
                  refreshCharts();
                  setSelectedId(stored.id);
                  setPhase('menu');
                });
              }}
            />
          </div>
        )}

        {phase === 'editing' && (
          <div className="overlay">
            <SectionEditor
              plan={chart.plan ?? flatPlan(chart.analysis.bpm, 0, chartDurationMs(chart) + 15_000)}
              onChange={() => {}}
              onClose={() => setPhase('menu')}
              onRegenerate={(plan: SongPlan) => {
                // Arrows are output; the plan is the thing worth keeping, so a
                // rebuild is cheap and repeatable rather than a re-tap.
                const rebuilt = generateChart(
                  analysisFromTempo({
                    bpm: plan.bpm,
                    firstBeatMs: plan.firstBeatMs,
                    durationMs: plan.durationMs,
                  }),
                  { song: chart.song, plan, difficulty: 'normal' },
                );
                void store.add(rebuilt, name || undefined).then((stored) => {
                  refreshCharts();
                  setSelectedId(stored.id);
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
                {(['PERFECT', 'GREAT', 'GOOD', 'OKAY', 'MISS'] as const).map((j) => (
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
                  <span className="board__name">
                    {player.name}
                    {/* Everyone who never typed a name is called "neko", so
                        without this the list is three identical rows and there
                        is no way to tell which ready is yours. */}
                    {player.id === room.playerId && <span className="board__you"> (you)</span>}
                    {player.canPlay === 'no' && room.room?.round.state === 'lobby' && (
                      <span className="board__blocked"> can't play</span>
                    )}
                    {player.ready && room.room?.round.state === 'lobby' && (
                      <span className="board__ready"> ready</span>
                    )}
                  </span>
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
