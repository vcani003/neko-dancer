/**
 * Cookie identity. The id is the person; the display name is a label.
 *
 * The server mints a UUID, puts it in an httpOnly cookie, and looks that
 * person up on the next request. Same browser, same person. New browser, new
 * person. Two people named "Vero" are two rows. There is no email, no IdP,
 * and the name never goes in the cookie — a script that could read it would
 * learn nothing it could not already see on the page.
 *
 * This file is HTTP-shaped and framework-free: it reads a `Cookie` header
 * and writes a `Set-Cookie` value. Fastify, when it arrives, calls these.
 */
import { asId, type UserId } from '@neko/protocol';

export const IDENTITY_COOKIE = 'neko.identity';

/** Chrome's practical ceiling. The cookie *is* the identity, so it lasts. */
export const IDENTITY_MAX_AGE_SEC = 400 * 24 * 60 * 60;

export function parseIdentityCookie(cookieHeader: string | undefined): UserId | null {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return null;

  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== IDENTITY_COOKIE) continue;

    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    return asId<UserId>(value);
  }
  return null;
}

export function serialiseIdentityCookie(
  userId: UserId,
  options: { secure: boolean; maxAgeSec?: number },
): string {
  const maxAge = options.maxAgeSec ?? IDENTITY_MAX_AGE_SEC;
  const parts = [
    `${IDENTITY_COOKIE}=${userId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
