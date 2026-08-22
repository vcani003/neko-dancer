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
  START: 'start',
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
