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
  START: 'start',
  QUEUE_SONG: 'queueSong',
} as const;

export const S2C = {
  WELCOME: 'welcome',
  ROOM: 'room',
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
  finished: boolean;
  sushi: number;
}

export interface RoomState {
  id: string;
  players: RoomPlayer[];
  playlist: Array<{ id: string; title: string; by: string }>;
  round: { state: string; songId: string | null; startedAt: number | null };
  songChooser: string | null;
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

export function useRoom(name: string, roomId: string, enabled: boolean) {
  const [connection, setConnection] = useState<ConnectionState>('closed');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);

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

  return { connection, room, chat, playerId, send };
}
