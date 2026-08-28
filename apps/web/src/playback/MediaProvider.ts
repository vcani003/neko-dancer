/**
 * Turning something a person pasted into something the game can play. §11.
 *
 * A provider answers one question — *what is this link?* — and nothing else. It
 * does not play, does not store, and does not decide whether the video is
 * allowed to run in this browser; that last one is per-viewer and belongs to
 * `checkVideoPlayable`.
 *
 * What comes back is a `MediaSource`: a **provider-facing descriptor with no id
 * of its own** (ADR-006). Persistent identity is `Song.id`, minted by whatever
 * stores it. Two identities for one piece of media is a question with no good
 * answer, so this side simply does not have one.
 */
import type { MediaSource } from '@neko/protocol';

export interface MediaProvider {
  /** A URL, a share link, or a bare id — whatever the person had to hand. */
  resolve(input: string): Promise<MediaSource>;
}

/**
 * Why a link could not be resolved, in words meant for the person who pasted it.
 *
 * The prototype's version of this threw YouTube's raw failure at the UI and the
 * result was "that video cannot be played here" for four unrelated causes, only
 * one of which the person could act on. A resolution failure has exactly three
 * shapes worth telling apart, because each has a different next move:
 *
 * | reason | what happened | what they can do |
 * |---|---|---|
 * | `unrecognised` | not a link this provider understands | paste a different link |
 * | `unavailable` | the provider says there is no such video | check it still exists |
 * | `unreachable` | the lookup itself failed | try again; nothing is wrong with the link |
 *
 * Collapsing `unreachable` into `unavailable` is the one that costs real time:
 * it blames a perfectly good link for a network blip, and the person goes off
 * hunting for another upload of a song that was fine.
 */
export type ResolveFailure = 'unrecognised' | 'unavailable' | 'unreachable';

export class MediaResolveError extends Error {
  readonly reason: ResolveFailure;
  readonly hint: string;

  constructor(reason: ResolveFailure, message: string, hint: string) {
    super(message);
    this.name = 'MediaResolveError';
    this.reason = reason;
    this.hint = hint;
  }
}
