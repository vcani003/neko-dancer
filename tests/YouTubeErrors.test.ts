/**
 * What YouTube's error codes actually mean.
 *
 * These existed as a single sentence — "that video cannot be played here" —
 * which is true of every failure and useful for none of them. The distinction
 * that costs the most time is 101/150: the video plays perfectly on youtube.com
 * and is blocked everywhere else, on purpose, and no amount of reloading will
 * change it.
 */
import { describe, expect, it } from 'vitest';
import { describeYouTubeError, YouTubePlaybackError } from '../src/playback/YouTubeAdapter.ts';

describe('describeYouTubeError', () => {
  it('says plainly that embedding is the uploader’s choice', () => {
    for (const code of [101, 150]) {
      const { message, hint } = describeYouTubeError(code);
      expect(message).toMatch(/uploader/i);
      // The advice has to be "use a different upload", because there is no
      // action on this side that helps.
      expect(hint).toMatch(/different upload/i);
    }
  });

  it('separates a missing video from a blocked one', () => {
    expect(describeYouTubeError(100).message).toMatch(/private, deleted/i);
    expect(describeYouTubeError(100).message).not.toMatch(/uploader/i);
  });

  it('separates a bad id from a broken player', () => {
    expect(describeYouTubeError(2).message).toMatch(/video id/i);
    expect(describeYouTubeError(5).message).toMatch(/player/i);
  });

  it('still says something useful about a code it has never seen', () => {
    const { message, hint } = describeYouTubeError(42);
    expect(message).toContain('42');
    expect(hint).toBeTruthy();
  });

  it('carries the code, so the room can be told which failure it was', () => {
    const { message, hint } = describeYouTubeError(150);
    const error = new YouTubePlaybackError(150, message, hint);
    expect(error.code).toBe(150);
    expect(error).toBeInstanceOf(Error);
  });
});
