/**
 * Turn a request's cookie into a `User`, minting one when there is none.
 *
 * A missing cookie, a cookie that is not a UUID, and a cookie for a row
 * that no longer exists are the same case: this is a new person. The
 * previous id is not reused — a wiped database must not resurrect a
 * stranger under a leftover cookie.
 */
import type { User } from '@neko/protocol';
import type { Store } from '../store.ts';
import { parseIdentityCookie, serialiseIdentityCookie } from './cookie.ts';

export interface ResolvedIdentity {
  readonly user: User;
  readonly setCookie: string | null;
}

export async function resolveIdentity(
  store: Store,
  cookieHeader: string | undefined,
  options: { displayName?: unknown; secure: boolean },
): Promise<ResolvedIdentity> {
  const existing = parseIdentityCookie(cookieHeader);
  if (existing) {
    const user = await store.getUser(existing);
    if (user) return { user, setCookie: null };
  }

  const user = await store.createUser({ displayName: options.displayName });
  return {
    user,
    setCookie: serialiseIdentityCookie(user.id, { secure: options.secure }),
  };
}
