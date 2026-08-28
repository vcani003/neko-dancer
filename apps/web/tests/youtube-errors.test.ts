/**
 * Every code YouTube can send has words a person can act on.
 *
 * The first version of this collapsed all of them into "that video cannot be
 * played here", and two people spent a round unable to tell whether the problem
 * was the link, the network, the room or the game.
 */
import { describe, expect, it } from 'vitest';
import { describeYouTubeError, youTubeError } from '../src/playback/YouTubeErrors.ts';

describe('describeYouTubeError', () => {
  it.each([
    [2, /did not recognise/i],
    [5, /could not start in this browser/i],
    [100, /private, deleted, or not available/i],
    [101, /outside YouTube/i],
    [150, /outside YouTube/i],
  ])('explains %i', (code, expected) => {
    expect(describeYouTubeError(code).message).toMatch(expected);
  });

  it('names the code for one it has never seen', () => {
    // Better than a shrug: an unknown number is still something to search for.
    expect(describeYouTubeError(42).message).toContain('42');
  });

  it.each([2, 5, 42, 100, 101, 150])('gives %i a next move, not just a diagnosis', (code) => {
    expect(describeYouTubeError(code).hint.length).toBeGreaterThan(0);
  });

  it('treats 101 and 150 as the same thing, because they are', () => {
    expect(describeYouTubeError(101)).toEqual(describeYouTubeError(150));
  });
});

describe('youTubeError', () => {
  it('keeps the code alongside the wording', () => {
    const error = youTubeError(150);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('YouTubePlaybackError');
    expect(error.code).toBe(150);
    expect(error.hint).toBe(describeYouTubeError(150).hint);
  });
});
