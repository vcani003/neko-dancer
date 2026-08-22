/**
 * The room connection.
 *
 * One socket, reconnecting on its own, exposing what the UI needs and nothing
 * else. Everything it receives is treated as untrusted: the server owns
 * ranking, and this only renders what it is told.
 *
 * Optional by design. A closed socket does not stop the game — you can play
 * alone with the server unreachable, and the room panel simply says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const C2S = {
  JOIN: 'join',
  CHAT: 'chat',
  SCORE: 'score',
  FINISH: 'finish',
  READY: 'ready',
  PICK_SONG: 'pickSong',
  /** Change your display name without leaving and rejoining. */
  RENAME: 'rename',
  /** "This is whether the room's song plays for me." Sent before readying. */
  CAN_PLAY: 'canPlay',
  /** "The song would not play for me." A code, never a message — see the server. */
  TROUBLE: 'trouble',
  QUEUE_SONG: 'queueSong',
} as const;

export const S2C = {
  WELCOME: 'welcome',
  ROOM: 'room',
  /**
   * The room's chosen song, in full, sent whenever it changes.
   *
   * Separate from ROOM because ROOM is broadcast on every score update — ten
   * times a second per player — and a chart is tens of kilobytes. Sending it
   * only on change is the difference between a few KB a minute and megabytes.
   */
  SONG: 'song',
  CHAT: 'chat',
  ROUND: 'round',
  ERROR: 'error',
} as const;

export interface RoomPlayer {
  rank: number;
  id: string;
  name: string;
  score: number;
  combo: number;
  health: number;
  ready: boolean;
  finished: boolean;
  sushi: number;
  /** 'unknown' until this player's browser has actually tried the song. */
  canPlay: 'unknown' | 'yes' | 'no';
  cannotPlayReason: string | null;
}

export interface RoomRound {
  state: 'lobby' | 'countdown' | 'playing' | 'results' | string;
  songId: string | null;
  startedAt: number | null;
  countdownMs?: number;
}

export interface RoomState {
  id: string;
  players: RoomPlayer[];
  playlist: Array<{ id: string; title: string; by: string }>;
  round: RoomRound;
  songChooser: string | null;
  song: { id: string; title: string; arrows: number; pickedBy: string | null } | null;
}

/**
 * The room's song as it arrived: a chart from another player, and therefore
 * untrusted. Deliberately typed `unknown` — the consumer validates it before
 * anything plays it.
 */
export interface RoomSong {
  chart: unknown;
  pickedBy: string | null;
}

export interface ChatLine {
  id: number;
  from?: string;
  text: string;
  system?: boolean;
}

export type ConnectionState = 'connecting' | 'open' | 'closed';

const RETRY_MS = 2000;
const MAX_CHAT_LINES = 60;

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Same host and port the page came from, so opening the LAN address just
  // works without anyone configuring anything.
  return `${protocol}//${window.location.host}`;
}

/**
 * What the room told us to do, and when.
 *
 * The countdown arrives as a DURATION rather than an instant. Machines do not
 * agree on the time and would need synchronising before an absolute moment
 * meant anything — but "start in three seconds" means the same on every clock,
 * and on a local network the difference in when each client receives it is a
 * millisecond or two.
 */
export interface RoundSignal {
  round: RoomRound;
  /** The chart everyone is about to play, sent with the go-ahead. */
  chart?: unknown;
  /** When this signal arrived here, in performance.now() terms. */
  receivedAtMs: number;
}

export function useRoom(name: string, roomId: string, enabled: boolean) {
  const [connection, setConnection] = useState<ConnectionState>('closed');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [signal, setSignal] = useState<RoundSignal | null>(null);
  const [song, setSong] = useState<RoomSong | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const chatIdRef = useRef(0);
  const identityRef = useRef({ name, roomId });
  useEffect(() => {
    identityRef.current = { name, roomId };
  }, [name, roomId]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setConnection('connecting');

      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl());
      } catch {
        setConnection('closed');
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        setConnection('open');
        socket.send(JSON.stringify({ type: C2S.JOIN, ...identityRef.current }));
      };

      socket.onmessage = (event) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message.type === S2C.WELCOME) setPlayerId(String(message.playerId));
        else if (message.type === S2C.ROOM) setRoom(message.room as RoomState);
        else if (message.type === S2C.SONG) {
          setSong({
            chart: message.chart,
            pickedBy: message.pickedBy == null ? null : String(message.pickedBy),
          });
        }
        else if (message.type === S2C.ROUND) {
          setSignal({
            round: message.round as RoomRound,
            chart: message.chart,
            // Stamped on arrival, so a countdown is measured from when this
            // machine heard it rather than from when React got round to it.
            receivedAtMs: performance.now(),
          });
        }
        else if (message.type === S2C.CHAT) {
          setChat((prev) =>
            [
              ...prev,
              {
                id: chatIdRef.current++,
                from: message.from as string | undefined,
                text: String(message.text ?? ''),
                system: message.system === true,
              },
            ].slice(-MAX_CHAT_LINES),
          );
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        setConnection('closed');
        // Retry quietly. A dropped socket must not interrupt a song.
        retryRef.current = window.setTimeout(connect, RETRY_MS);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposed = true;
      if (retryRef.current !== null) window.clearTimeout(retryRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled]);

  const send = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, ...payload }));
    }
  }, []);

  return { connection, room, chat, playerId, signal, song, send };
}
