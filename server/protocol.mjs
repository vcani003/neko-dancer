/**
 * The wire protocol, in one file both ends import.
 *
 * Kept as data rather than scattered string literals, so a typo in a message
 * name is a missing export instead of a message that silently never arrives.
 */

/** Client -> server. */
export const C2S = {
  JOIN: 'join',
  CHAT: 'chat',
  SCORE: 'score',
  FINISH: 'finish',
  READY: 'ready',
  PICK_SONG: 'pickSong',
  QUEUE_SONG: 'queueSong',
};

/** Server -> client. */
export const S2C = {
  WELCOME: 'welcome',
  ROOM: 'room',
  CHAT: 'chat',
  ROUND: 'round',
  ERROR: 'error',
};

export const MAX_NAME_LENGTH = 20;
export const MAX_CHAT_LENGTH = 200;
export const MAX_PLAYLIST = 10;

/** Sushi is only earned in a room with other people, as in the original. */
export const MIN_PLAYERS_FOR_REWARD = 2;

/**
 * How long everyone waits between the last ready and the first arrow.
 *
 * Long enough to get hands onto keys, short enough that nobody drums their
 * fingers. It is also the window that absorbs the difference in when each
 * client receives the go-ahead.
 */
export const COUNTDOWN_MS = 3000;
