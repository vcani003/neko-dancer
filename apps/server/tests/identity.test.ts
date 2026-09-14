/**
 * Same browser, same person. The name is a label on that person.
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_COOKIE, resolveIdentity } from '@neko/server';
import { openTestStore } from './helpers.ts';

describe('resolveIdentity', () => {
  it('mints a user and a Set-Cookie when there is no cookie', async () => {
    const { store } = await openTestStore();
    const first = await resolveIdentity(store, undefined, { displayName: 'Vero', secure: false });
    expect(first.user.displayName).toBe('Vero');
    expect(first.setCookie).toContain(`${IDENTITY_COOKIE}=${first.user.id}`);
    expect(first.setCookie).toContain('HttpOnly');
  });

  it('returns the same user for the same cookie, and does not set one again', async () => {
    const { store } = await openTestStore();
    const first = await resolveIdentity(store, undefined, { displayName: 'Vero', secure: false });
    const cookie = `${IDENTITY_COOKIE}=${first.user.id}`;
    const again = await resolveIdentity(store, cookie, { displayName: 'Someone Else', secure: false });
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.displayName).toBe('Vero');
    expect(again.setCookie).toBeNull();
  });

  it('treats two people named Vero as two users', async () => {
    const { store } = await openTestStore();
    const a = await resolveIdentity(store, undefined, { displayName: 'Vero', secure: false });
    const b = await resolveIdentity(store, undefined, { displayName: 'Vero', secure: false });
    expect(a.user.id).not.toBe(b.user.id);
    expect(a.user.displayName).toBe('Vero');
    expect(b.user.displayName).toBe('Vero');
  });

  it('mints a new person when the cookie is not a uuid', async () => {
    const { store } = await openTestStore();
    const forged = await resolveIdentity(store, `${IDENTITY_COOKIE}=not-a-uuid`, {
      displayName: 'neko',
      secure: false,
    });
    expect(forged.setCookie).toContain(forged.user.id);

    const first = await resolveIdentity(store, undefined, { displayName: 'gone', secure: false });
    const live = await resolveIdentity(store, `${IDENTITY_COOKIE}=${first.user.id}`, {
      displayName: 'back',
      secure: false,
    });
    expect(live.user.id).toBe(first.user.id);
    expect(live.setCookie).toBeNull();
  });

  it('falls back to neko when the name is empty or hostile', async () => {
    const { store } = await openTestStore();
    const empty = await resolveIdentity(store, undefined, { displayName: '   ', secure: false });
    expect(empty.user.displayName).toBe('neko');
  });
});
