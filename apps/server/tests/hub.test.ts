/**
 * Public cap, auto-start, mid-song spectate, and chat that names the seat.
 */
import { describe, expect, it } from 'vitest';
import { ROOM_START_BUFFER_MS } from '@neko/protocol';
import type { RevisionId, User, UserId } from '@neko/protocol';
import { PUBLIC_CAP, PUBLIC_ROOM_ID, RoomHub, STAGING_ROOM_ID } from '@neko/server';

function person(n: number): User {
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}` as UserId;
  return { id, displayName: `P${n}`, createdAtIso: '2026-03-01T12:00:00.000Z' };
}

function inbox(): { send: (payload: unknown) => void; messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    messages,
    send(payload) {
      messages.push(typeof payload === 'string' ? JSON.parse(payload) : payload);
    },
  };
}

const CHART = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as RevisionId;

describe('RoomHub', () => {
  it('refuses a seventh person in Public', () => {
    const hub = new RoomHub();
    for (let n = 0; n < PUBLIC_CAP; n += 1) {
      expect(hub.join(PUBLIC_ROOM_ID, person(n), () => undefined).ok).toBe(true);
    }
    const seventh = hub.join(PUBLIC_ROOM_ID, person(6), () => undefined);
    expect(seventh).toEqual({ ok: false, error: 'That room is full (6).' });
    expect(hub.listing()[0]?.occupants).toBe(6);
  });

  it('does not evict a reseated player when the old socket closes', () => {
    const hub = new RoomHub();
    const a = person(1);
    const first = inbox();
    const second = inbox();
    expect(hub.join(PUBLIC_ROOM_ID, a, first.send)).toEqual({
      ok: true,
      roomId: PUBLIC_ROOM_ID,
      start: true,
    });
    expect(hub.join(PUBLIC_ROOM_ID, a, second.send)).toEqual({
      ok: true,
      roomId: PUBLIC_ROOM_ID,
      start: false,
    });
    expect(hub.leave(a.id, first.send)).toEqual({
      roomId: PUBLIC_ROOM_ID,
      emptied: false,
      startNext: false,
    });
    expect(hub.occupants(PUBLIC_ROOM_ID)).toBe(1);
  });

  it('starts a song when the first person walks into an empty Public room', () => {
    const hub = new RoomHub();
    const first = hub.join(PUBLIC_ROOM_ID, person(1), () => undefined);
    expect(first).toEqual({ ok: true, roomId: PUBLIC_ROOM_ID, start: true });
  });

  it('does not start a second countdown while the first is arming', () => {
    const hub = new RoomHub();
    hub.join(PUBLIC_ROOM_ID, person(1), () => undefined);
    const second = hub.join(PUBLIC_ROOM_ID, person(2), () => undefined);
    expect(second).toEqual({ ok: true, roomId: PUBLIC_ROOM_ID, start: false });
  });

  it('lets a mid-countdown arrival play the same chart with the remaining delay', () => {
    let now = 1_000;
    const hub = new RoomHub(() => now);
    hub.join(PUBLIC_ROOM_ID, person(1), () => undefined);
    expect(hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS)).toBe(true);
    now = 4_000;
    const late = hub.join(PUBLIC_ROOM_ID, person(2), () => undefined);
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    expect(late.start).toBe(false);
    expect(late.catchup).toEqual({
      revisionId: CHART,
      countdownMs: ROOM_START_BUFFER_MS - 3_000,
    });
    expect(late.spectate).toBeUndefined();
  });

  it('makes a mid-song arrival spectate', () => {
    let now = 0;
    const hub = new RoomHub(() => now);
    hub.join(PUBLIC_ROOM_ID, person(1), () => undefined);
    hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS);
    now = ROOM_START_BUFFER_MS;
    hub.markPlaying(PUBLIC_ROOM_ID);
    now = ROOM_START_BUFFER_MS + 5_500;
    const late = hub.join(PUBLIC_ROOM_ID, person(2), () => undefined);
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    expect(late.spectate).toEqual({ revisionId: CHART, elapsedMs: 5_500 });
    expect(late.catchup).toBeUndefined();
  });

  it('treats a join after the buffer as spectate even before markPlaying', () => {
    let now = 0;
    const hub = new RoomHub(() => now);
    hub.join(PUBLIC_ROOM_ID, person(1), () => undefined);
    hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS);
    now = ROOM_START_BUFFER_MS;
    const late = hub.join(PUBLIC_ROOM_ID, person(2), () => undefined);
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    expect(late.spectate).toEqual({ revisionId: CHART, elapsedMs: 0 });
  });

  it('starts the next song after every player in the round finishes', () => {
    const hub = new RoomHub();
    const a = person(1);
    const b = person(2);
    hub.join(PUBLIC_ROOM_ID, a, () => undefined);
    hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS);
    hub.join(PUBLIC_ROOM_ID, b, () => undefined);
    hub.markPlaying(PUBLIC_ROOM_ID);
    expect(hub.finish(a.id)).toEqual({ roomId: PUBLIC_ROOM_ID, startNext: false });
    expect(hub.finish(b.id)).toEqual({ roomId: PUBLIC_ROOM_ID, startNext: true });
  });

  it('does not let a spectator finish the round for the people who are playing', () => {
    let now = 0;
    const hub = new RoomHub(() => now);
    const a = person(1);
    hub.join(PUBLIC_ROOM_ID, a, () => undefined);
    hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS);
    now = ROOM_START_BUFFER_MS;
    hub.markPlaying(PUBLIC_ROOM_ID);
    const spectator = person(2);
    hub.join(PUBLIC_ROOM_ID, spectator, () => undefined);
    expect(hub.finish(spectator.id)).toEqual({ roomId: PUBLIC_ROOM_ID, startNext: false });
    expect(hub.finish(a.id)).toEqual({ roomId: PUBLIC_ROOM_ID, startNext: true });
  });

  it('starts the next song when the last player leaves and spectators remain', () => {
    let now = 0;
    const hub = new RoomHub(() => now);
    const a = person(1);
    hub.join(PUBLIC_ROOM_ID, a, () => undefined);
    hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS);
    now = ROOM_START_BUFFER_MS;
    hub.markPlaying(PUBLIC_ROOM_ID);
    hub.join(PUBLIC_ROOM_ID, person(2), () => undefined);
    expect(hub.leave(a.id)).toEqual({
      roomId: PUBLIC_ROOM_ID,
      emptied: false,
      startNext: true,
    });
  });

  it('resets an emptied room so the next arrival starts a new song', () => {
    const hub = new RoomHub();
    const a = person(1);
    hub.join(PUBLIC_ROOM_ID, a, () => undefined);
    hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS);
    expect(hub.leave(a.id)).toEqual({
      roomId: PUBLIC_ROOM_ID,
      emptied: true,
      startNext: false,
    });
    expect(hub.join(PUBLIC_ROOM_ID, person(2), () => undefined)).toEqual({
      ok: true,
      roomId: PUBLIC_ROOM_ID,
      start: true,
    });
  });

  it('names the speaker from the seat, not from the chat payload', () => {
    const hub = new RoomHub();
    const a = person(1);
    const { send, messages } = inbox();
    hub.join(PUBLIC_ROOM_ID, a, send);
    hub.chat(a.id, 'hello');
    expect(messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'chat', from: 'P1', text: 'hello' })]),
    );
  });

  it('starts the next Public song even if finish arrives during the buffer', () => {
    const hub = new RoomHub();
    const a = person(1);
    hub.join(PUBLIC_ROOM_ID, a, () => undefined);
    hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS);
    expect(hub.finish(a.id)).toEqual({ roomId: PUBLIC_ROOM_ID, startNext: true });
  });

  it('waits for Ready in Staging and does not auto-start', () => {
    const hub = new RoomHub();
    const a = person(1);
    const revision = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as RevisionId;
    expect(hub.join(STAGING_ROOM_ID, a, () => undefined, revision)).toEqual({
      ok: true,
      roomId: STAGING_ROOM_ID,
      start: false,
    });
    expect(hub.stagingRevision()).toBe(revision);
    expect(hub.ready(a.id, true)).toEqual({ allReady: true, roomId: STAGING_ROOM_ID });
  });

  it('does not chain the next song after a Staging run', () => {
    const hub = new RoomHub();
    const a = person(1);
    hub.join(STAGING_ROOM_ID, a, () => undefined, CHART);
    hub.ready(a.id, true);
    hub.beginCountdown(STAGING_ROOM_ID, CHART, 3000);
    hub.markPlaying(STAGING_ROOM_ID);
    expect(hub.finish(a.id)).toEqual({ roomId: STAGING_ROOM_ID, startNext: false });
  });

  it('advances Public to the next chart when asked, even mid-song', () => {
    const hub = new RoomHub();
    const a = person(1);
    hub.join(PUBLIC_ROOM_ID, a, () => undefined);
    hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS);
    hub.markPlaying(PUBLIC_ROOM_ID);
    expect(hub.advancePublic(a.id)).toEqual({ roomId: PUBLIC_ROOM_ID, start: true });
    expect(hub.beginCountdown(PUBLIC_ROOM_ID, CHART, ROOM_START_BUFFER_MS)).toBe(true);
  });

  it('ignores Ready in Public', () => {
    const hub = new RoomHub();
    const a = person(1);
    hub.join(PUBLIC_ROOM_ID, a, () => undefined);
    expect(hub.ready(a.id, true)).toBeNull();
  });
});
