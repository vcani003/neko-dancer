# Security

Written at the point this stopped being a single-player toy. Multiplayer,
accounts and a server change what a bug costs: the failure mode is no longer
"the game feels wrong", it is "someone else's machine, data or identity".

Everything below is either **fixed**, **known and bounded**, or **not built
yet** — and the difference is stated, because a security document that implies
more than it delivers is worse than none.

---

## 1. Repository visibility — keep it private

Not primarily a security matter, but it belongs at the top.

**This is a recreation of someone else's game.** Nekodancer, its name, its cat
and its design belong to Atelier 801. Building a recreation to learn from is
ordinary; publishing one publicly under the original's name is a different act,
and it is the one that attracts attention nobody wants.

There are security reasons too. They are real but secondary:

- Once accounts exist, a public repository makes an accidentally committed
  secret far more expensive — public repos are scraped for keys continuously.
- The server currently trusts client-reported scores (§4). That is a known,
  documented weakness, and it does not need advertising while it stands.

**If it should ever be public**, the honest route is a different name, original
art, and a README saying plainly what it is inspired by.

---

## 2. Fixed in this pass

**Cross-site WebSocket hijacking.** The socket now checks `Origin` against the
server's own host. Without it, any website the host visited could open a socket
to this server — browsers send those requests willingly, because WebSockets are
not bound by the same-origin policy the way `fetch` is. A random tab could have
joined rooms, read chat and posted as whoever was running the server. A missing
`Origin` is still allowed, since non-browser clients do not send one and the
threat here is specifically a browser being turned against its owner.

**Path traversal in static serving.** Paths are normalised and then compared
against the served directory **with a trailing separator**. The earlier check
used a plain `startsWith`, which a sibling directory named `dist-anything`
would have satisfied — the classic version of this bug, and it was present.
Malformed percent-encoding is now rejected rather than thrown on.

**Unbounded input.** Messages are capped at 512 KB, sockets at 40 messages per
2 seconds before being closed, rooms at 16 players, the server at 32 rooms, and
chat history at 60 lines. Every one of these exists because the alternative was
unbounded, and unbounded loses to an accident long before it loses to an
attacker.

**A cap that was itself an outage.** The message limit started at 4 KB, which is
smaller than any real chart — a 366-arrow song is about 21 KB — so pressing
"I'm ready" tripped it. Worse, `ws` reports an oversized frame by emitting
`error` on the socket, and with no handler registered Node's unhandled-`error`
behaviour took the whole process down. The protection against denial of service
*was* a denial of service, reachable by any client in one message.

Both halves are fixed: sockets and the server carry error handlers that log and
close rather than throw, and the cap is sized against the largest message the
game legitimately sends. The real guard against an absurd chart remains the
arrow-count check, which bounds what a message may *contain* rather than only
how large it is.

Verified by attacking a running server with a 2 MB frame: the server stayed up,
a bystander's connection was unaffected, and a realistic chart was still
accepted.

The lesson generalises. **A limit set without measuring the traffic it must
allow is a guess**, and a guess that rejects normal use is worse than no limit
at all — it fails closed, loudly, on the happy path.

**Duplicate joins.** One room per socket. Rejoining without leaving left a
ghost player behind and let one connection hold several seats.

**Control characters** are stripped from names and chat, which otherwise
corrupt terminals and logs downstream.

---

## 3. Safe by construction

**Cross-site scripting.** All player text is rendered through React, which
escapes by default, and there is no `dangerouslySetInnerHTML` anywhere in the
codebase. Names and chat are additionally sanitised server-side, so the
protection does not rest on one framework's behaviour alone.

**Ranking.** Computed on the server from the scores it holds, never accepted
from a client.

**No secrets.** There are none yet — no tokens, no keys, no database
credentials. When there are, they belong in the environment and never in the
repository, and `.gitignore` should carry `.env` before the first one exists.

---

## 4. Known and bounded — not solved

**Scores are client-authoritative.** The client computes its score and reports
it; the server bounds the value and otherwise believes it. Anyone able to open
a socket can claim any score under the cap.

That is acceptable for a game on a home network among people who know each
other. It is not acceptable for a public leaderboard, and the fix is structural
rather than a patch: judgment has to happen on the server, which means the
server needs the chart and the input events rather than the result. Worth doing
before any score is published anywhere, and not before.

**No authentication.** Anyone can claim any name, including one already in use.
There is nothing to steal yet, because there are no accounts — but the moment
there are, impersonation stops being cosmetic. See §6.

**Network exposure.** The server binds every interface by default, because the
entire point is that other people can join. That also means **anyone who can
reach the machine can reach the server** — fine on a home network, not fine on
café or campus wifi, where "everyone" is a much larger group.

    HOST=127.0.0.1 npm run serve   # this machine only

**Denial of service.** The limits above stop accidents and casual abuse. They
would not stop someone determined, and nothing here should be exposed to the
open internet as it stands.

---

## 5. Not built yet

Named so they are decisions rather than omissions:

- No TLS. Traffic on the LAN is plaintext, including chat.
- No persistence, so nothing to leak yet — and nothing to lose.
- No moderation tools: no block, mute, report or kick.
- No audit log of who did what in a room.

---

## 6. Before accounts exist

The point at which this becomes genuinely someone else's problem rather than
only ours. In rough order:

1. **Never store passwords.** Prefer an existing identity provider. If that is
   impossible, argon2id — never a bare hash, never a fast one.
2. **Sessions in httpOnly, SameSite cookies.** A token in `localStorage` is
   readable by any script that gets onto the page.
3. **Server-authoritative scoring first.** Accounts make cheating worth doing.
4. **Rate-limit authentication separately** and far harder than gameplay.
5. **Decide what is actually stored,** and store the minimum. An email address
   is a liability; a display name is not.
6. **Plan for deletion** before the first account exists. Retrofitting "delete
   my data" onto a schema that assumed permanence is miserable.
7. **TLS everywhere** the moment a credential crosses a network.

---

## 7. Reporting

Nothing here is deployed publicly and no user data exists. If that changes,
this section needs a real contact route and a stated response time — an
unmonitored inbox is worse than none.
