/**
 * Public or Staging, on the existing stage.
 *
 * Public shuffles published charts and has chat. Songs start themselves.
 * A mid-song join is spectate. Staging is a workshop: Ready starts the
 * one chart, and the YouTube pause button works.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { asId, type BeatmapId, type RevisionId, type RoundResult, type User } from '@neko/protocol';
import type { RoomPlayerView } from '../../../../../src/render/LaneRenderer.ts';
import { HttpCatalog } from '../../play/HttpCatalog.ts';
import { readFigure } from '../shared/figure.ts';
import { PUBLIC_CAP, readRoomTheme } from '../shared/roomTheme.ts';
import { ChatPanel, type ChatLine } from './ChatPanel.tsx';
import { Stage, type PlayRequest } from './Stage.tsx';

type Seat = { id: string; name: string; ready?: boolean; say?: string; sayAtMs?: number };

function roomFromQuery(): {
  roomId: 'public' | 'staging';
  revisionId: RevisionId | null;
  beatmapId: BeatmapId | null;
  intent: 'draft' | 'publish';
} {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room') === 'staging' ? 'staging' : 'public';
  return {
    roomId,
    revisionId: asId<RevisionId>(params.get('revision')),
    beatmapId: asId<BeatmapId>(params.get('beatmap')),
    intent: params.get('intent') === 'publish' ? 'publish' : 'draft',
  };
}

export function RoomPage() {
  const catalog = useMemo(() => new HttpCatalog(), []);
  const query = useMemo(() => roomFromQuery(), []);
  const kind = useMemo(() => readFigure(), []);
  const theme = useMemo(() => readRoomTheme(), []);
  const [user, setUser] = useState<User | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [play, setPlay] = useState<PlayRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState(false);
  const [chartTitle, setChartTitle] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const nextLine = useRef(1);
  const playGen = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;

    void (async () => {
      try {
        const me = await catalog.me();
        if (cancelled) return;
        setUser(me);
        if (query.revisionId) {
          const chart = await catalog.getPlayable(query.revisionId);
          if (chart && !cancelled) setChartTitle(chart.beatmap.title ?? chart.song.title);
        }
      } catch {
        if (!cancelled) {
          setError('The store is not running. In another terminal, from this repo: npm run api');
        }
        return;
      }

      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (cancelled) return;
        setOpen(true);
        socket?.send(
          JSON.stringify({
            type: 'join',
            roomId: query.roomId,
            ...(query.revisionId ? { revisionId: query.revisionId } : {}),
          }),
        );
      });

      socket.addEventListener('message', (event) => {
        let data: unknown;
        try {
          data = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!data || typeof data !== 'object') return;
        const message = data as {
          type?: string;
          user?: User;
          players?: Seat[];
          text?: string;
          from?: string;
          userId?: string;
          system?: boolean;
          revisionId?: string;
          countdownMs?: number;
          spectate?: boolean;
          elapsedMs?: number;
          error?: string;
        };

        if (message.type === 'welcome' && message.user) {
          setUser(message.user);
          return;
        }
        if (message.type === 'room' && Array.isArray(message.players)) {
          setSeats((prev) => {
            const said = new Map(prev.map((seat) => [seat.id, seat]));
            return message.players!.map((seat) => {
              const keep = said.get(seat.id);
              return {
                ...seat,
                ...(keep?.say ? { say: keep.say, sayAtMs: keep.sayAtMs } : {}),
              };
            });
          });
          return;
        }
        if (message.type === 'chat' && typeof message.text === 'string') {
          const id = nextLine.current;
          nextLine.current += 1;
          setChat((prev) => [
            ...prev,
            {
              id,
              text: message.text ?? '',
              ...(message.from ? { from: message.from } : {}),
              ...(message.system ? { system: true } : {}),
            },
          ]);
          if (!message.system && message.text) {
            const who = message.userId;
            const name = message.from;
            const at = performance.now();
            setSeats((prev) =>
              prev.map((seat) => {
                const mine = who ? seat.id === who : seat.name === name;
                return mine ? { ...seat, say: message.text, sayAtMs: at } : seat;
              }),
            );
          }
          return;
        }
        if (message.type === 'round') {
          const revisionId = asId<RevisionId>(message.revisionId);
          if (!revisionId) return;
          playGen.current += 1;
          setPlay({
            revisionId,
            gen: playGen.current,
            countdownMs: typeof message.countdownMs === 'number' ? message.countdownMs : undefined,
            spectate: message.spectate === true,
            elapsedMs: typeof message.elapsedMs === 'number' ? message.elapsedMs : undefined,
          });
          return;
        }
        if (message.type === 'error' && typeof message.error === 'string') {
          setError(message.error);
        }
      });

      socket.addEventListener('close', () => {
        if (!cancelled) setOpen(false);
      });
    })();

    return () => {
      cancelled = true;
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [catalog, query]);

  function send(payload: unknown): void {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  function onFinished(result: RoundResult): void {
    send({ type: 'finish', result });
    if (query.roomId !== 'public') return;
    send({ type: 'next' });
    const gen = playGen.current;
    window.setTimeout(() => {
      if (playGen.current !== gen) return;
      send({ type: 'next' });
      void catalog.listPublished().then((listed) => {
        if (playGen.current !== gen || listed.length === 0) return;
        const pick = listed[Math.floor(Math.random() * listed.length)];
        if (!pick) return;
        playGen.current += 1;
        setPlay({
          revisionId: pick.revisionId,
          gen: playGen.current,
          countdownMs: 10_000,
        });
      });
    }, 2_000);
  }

  function replay(): void {
    const revisionId = play?.revisionId ?? query.revisionId;
    if (!revisionId) return;
    playGen.current += 1;
    setPlay({ revisionId, gen: playGen.current });
  }

  async function confirmPublish(): Promise<void> {
    if (!query.beatmapId) return;
    try {
      await catalog.publishBeatmap(query.beatmapId);
      setPublished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish that chart.');
    }
  }

  const players: RoomPlayerView[] = seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    isMe: seat.id === user?.id,
    kind: seat.id === user?.id ? kind : 'cat',
    say: seat.say,
    sayAtMs: seat.sayAtMs,
  }));

  const publicRoom = query.roomId === 'public';
  const stagingBlocked = query.roomId === 'staging' && !query.revisionId;
  const mine = seats.find((seat) => seat.id === user?.id);

  function toggleReady(): void {
    send({ type: 'ready', ready: !mine?.ready });
  }

  const readyButton = (
    <button type="button" className="button--primary" disabled={!open || stagingBlocked} onClick={toggleReady}>
      {mine?.ready ? 'Unready' : 'Ready'}
    </button>
  );

  const waiting = (
    <>
      {error && (
        <div className="readybar">
          <div className="error">{error}</div>
        </div>
      )}
      {stagingBlocked && (
        <div className="readybar">
          <div className="error">Staging needs a chart. Save one from Create.</div>
        </div>
      )}
      {!publicRoom && !stagingBlocked && (
        <div className="readybar">
          {chartTitle && <span className="hint">{chartTitle}</span>}
          {readyButton}
        </div>
      )}
    </>
  );

  const resultsExtra = (
    <div className="actions">
      {!publicRoom && readyButton}
      {!publicRoom && (
        <button type="button" className="button--primary" onClick={replay}>
          Play again
        </button>
      )}
      {!publicRoom && query.intent === 'publish' && !published && (
        <button type="button" onClick={() => void confirmPublish()}>
          Publish to public
        </button>
      )}
      {published && <span className="hint">It is in the public shuffle now.</span>}
      <a href="/create.html">Create</a>
      <a href="/">Home</a>
    </div>
  );

  return (
    <div className={publicRoom ? 'app' : 'app app--solo'} data-room={theme}>
      <a className="leave" href="/">
        Leave
      </a>
      <Stage
        catalog={catalog}
        user={user}
        kind={kind}
        players={players}
        play={play}
        waiting={waiting}
        resultsExtra={publicRoom ? undefined : resultsExtra}
        onFinished={onFinished}
        allowVideoClicks={!publicRoom}
      />
      {publicRoom && (
        <div className="chatbar">
          <ChatPanel lines={chat} onSend={(text) => send({ type: 'chat', text })} disabled={!open} />
          <div className="chatbar__here">
            <h2 className="side__header">
              Public · {seats.length} / {PUBLIC_CAP}
            </h2>
            {seats.length === 0 ? (
              <p className="hint">{open ? 'Sitting down…' : 'Connecting…'}</p>
            ) : (
              <div className="side__list">
                {seats.map((seat) => (
                  <div key={seat.id}>
                    {seat.name}
                    {seat.id === user?.id ? ' (you)' : ''}
                  </div>
                ))}
              </div>
            )}
            <div className="chatbar__actions">
              <a className="side__leave" href="/">
                Leave
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
