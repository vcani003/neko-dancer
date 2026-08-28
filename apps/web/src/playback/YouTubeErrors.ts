/**
 * What YouTube said, translated for the person who has to act on it.
 *
 * YouTube reports exactly what went wrong — a number on the error event — and
 * the first version of this threw all of it away in favour of "that video
 * cannot be played here". Two people then spent a round unable to tell whether
 * the problem was the link, the network, the room, or the game.
 *
 * The distinction that matters most: a video can be perfectly playable on
 * youtube.com and still refuse to play inside another site. That is the
 * uploader's setting, it is not something this game can work around, and the
 * only fix is a different upload — which is worth saying out loud rather than
 * leaving someone to reload hopefully.
 */
export class YouTubePlaybackError extends Error {
  readonly code: number;
  readonly hint: string;

  constructor(code: number, message: string, hint: string) {
    super(message);
    this.name = 'YouTubePlaybackError';
    this.code = code;
    this.hint = hint;
  }
}

/** https://developers.google.com/youtube/iframe_api_reference#onError */
export function describeYouTubeError(code: number): { message: string; hint: string } {
  switch (code) {
    case 2:
      return {
        message: 'YouTube did not recognise that video id.',
        hint: 'Add the song again from its YouTube link.',
      };
    case 5:
      return {
        message: "YouTube's player could not start in this browser.",
        hint: 'Reload the page, and try a different browser if it keeps happening.',
      };
    case 100:
      return {
        message: 'That video is private, deleted, or not available in your country.',
        hint: 'Someone else may still be able to see it — try another upload of the song.',
      };
    case 101:
    case 150:
      return {
        // The one people misread as a bug in the game. It is not: the video
        // plays on youtube.com and is blocked everywhere else, on purpose.
        message: 'The uploader does not allow this video to play outside YouTube.',
        hint: 'Nothing here can change that — pick a different upload of the same song.',
      };
    default:
      return {
        message: `YouTube refused to play that video (error ${code}).`,
        hint: 'Try another upload of the song.',
      };
  }
}

/** Build the error from the code alone, so the wording lives in one place. */
export function youTubeError(code: number): YouTubePlaybackError {
  const { message, hint } = describeYouTubeError(code);
  return new YouTubePlaybackError(code, message, hint);
}
