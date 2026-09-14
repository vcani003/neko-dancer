/**
 * The cookie is the identity. These tests pin the attributes that make
 * that safe, and the parse rules that refuse a forged one.
 */
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_COOKIE,
  IDENTITY_MAX_AGE_SEC,
  parseIdentityCookie,
  serialiseIdentityCookie,
} from '@neko/server';
import { asId, type UserId } from '@neko/protocol';

const ID = asId<UserId>('9f2a4c1e-1111-4111-8111-111111111111');
if (!ID) throw new Error('fixture id');

describe('serialiseIdentityCookie', () => {
  it('writes HttpOnly, SameSite, Path, and a long Max-Age', () => {
    const header = serialiseIdentityCookie(ID, { secure: false });
    expect(header.startsWith(`${IDENTITY_COOKIE}=${ID}`)).toBe(true);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain(`Max-Age=${IDENTITY_MAX_AGE_SEC}`);
  });

  it('adds Secure only when asked — HTTP on a LAN must still work', () => {
    expect(serialiseIdentityCookie(ID, { secure: false })).not.toContain('Secure');
    expect(serialiseIdentityCookie(ID, { secure: true })).toContain('Secure');
  });

  it('puts only the id in the cookie value', () => {
    const header = serialiseIdentityCookie(ID, { secure: true });
    const [pair] = header.split(';');
    expect(pair).toBe(`${IDENTITY_COOKIE}=${ID}`);
  });
});

describe('parseIdentityCookie', () => {
  it('reads the id out of a Cookie header among others', () => {
    expect(parseIdentityCookie(`other=1; ${IDENTITY_COOKIE}=${ID}; theme=dark`)).toBe(ID);
  });

  it('accepts a quoted value', () => {
    expect(parseIdentityCookie(`${IDENTITY_COOKIE}="${ID}"`)).toBe(ID);
  });

  it('returns null for missing, empty, or non-uuid values', () => {
    expect(parseIdentityCookie(undefined)).toBeNull();
    expect(parseIdentityCookie('')).toBeNull();
    expect(parseIdentityCookie('theme=dark')).toBeNull();
    expect(parseIdentityCookie(`${IDENTITY_COOKIE}=not-a-uuid`)).toBeNull();
    expect(parseIdentityCookie(`${IDENTITY_COOKIE}=`)).toBeNull();
  });
});
