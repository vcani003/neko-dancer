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
  /** Change your display name without leaving and rejoining. */
  RENAME: 'rename',
  /**
   * "I have checked, and this is whether the video plays for me."
   *
   * Sent when the room's song changes, before anyone readies. A video that
   * one player cannot embed is a fact about the lobby, not a surprise to be
   * discovered three seconds into a countdown.
   */
  CAN_PLAY: 'canPlay',
  /**
   * "The song would not play for me."
   *
   * Carries a CODE, never a message. The room announces it as a system line,
   * and system lines look authoritative — so the wording has to come from the
   * server. A client that could write its own would be able to post official-
   * looking text in everyone's chat.
   */
  TROUBLE: 'trouble',
  QUEUE_SONG: 'queueSong',
};

/** Server -> client. */
export const S2C = {
  WELCOME: 'welcome',
  ROOM: 'room',
  /**
   * The room's chart, in full.
   *
   * Its own message rather than part of ROOM: room state is broadcast on every
   * score update, ten times a second per player, and a chart is tens of
   * kilobytes. Sending it only when it changes is the difference between a few
   * KB a minute and a few megabytes.
   */
  SONG: 'song',
  CHAT: 'chat',
  ROUND: 'round',
  ERROR: 'error',
};

export const MAX_NAME_LENGTH = 20;
export const MAX_CHAT_LENGTH = 200;
/**
 * A song title, as displayed to other people.
 *
 * Bounded for the same reason chat is, and then one more: the room summary
 * carries the title and is broadcast on every score update, ten times a second
 * per player. An unbounded title is not just ugly, it is a bandwidth
 * multiplier — a 256 KB title becomes tens of megabytes a second of outbound
 * traffic from a single small message.
 */
export const MAX_TITLE_LENGTH = 100;
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
