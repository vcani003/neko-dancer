# Architecture

What the pieces are, why they are separate, and what is built so far.

Companion to `ENGINEERING.md` (how to write code here), `SECURITY.md` (what
happens when someone is hostile) and `PLAYTEST-FINDINGS.md` (what broke and
why).

---

## Specs

| | |
|---|---|
| **Type** | Browser rhythm game with a LAN multiplayer server |
| **Stack** | React 19 · TypeScript 6 · Vite 8 · PixiJS 8 · `ws` · Vitest 3 |
| **Client** | 29 TS/TSX files, ~5,650 lines |
| **Server** | 3 `.mjs` files, ~980 lines, plain JavaScript on purpose |
| **Tests** | **244**, across 14 suites |
| **Bundle** | ~513 KB, one chunk |
| **Backend** | Node HTTP + WebSocket. No database, no accounts yet |
| **Persistence** | `localStorage` only. A server-side chart library is in progress |
| **Deployed** | No. Runs on the host's machine, reachable on the local network |

**Recreation of Nekodancer (Atelier 801).** The original is deprecated. The name
and the design are theirs; the code and the cat are original. The repository is
private for that reason before any security one — see `SECURITY.md` §1.

---

## The shape

```
     BROWSER                                    HOST MACHINE
  ┌──────────────────────────────┐          ┌──────────────────────┐
  │  React UI                    │          │  server/index.mjs    │
  │   menu · lobby · chat · HUD  │          │   HTTP: serves dist/ │
  │            │                 │          │   WS:   rooms        │
  │  ┌─────────┴─────────┐       │◄───ws───►│                      │
  │  │ GameEngine        │       │          │  server/rooms.mjs    │
  │  │  LaneJudge        │       │          │   Room · Registry    │
  │  │  ScoreSystem      │       │          │   scoreboard         │
  │  └─────────┬─────────┘       │          │                      │
  │            │                 │          │  server/protocol.mjs │
  │       GameClock  ◄── time ── │          │   message names      │
  │            │                 │          │   shared limits      │
  │   PlaybackAdapter            │          └──────────────────────┘
  │    YouTube │ ClickTrack │ …  │
  │            │                 │            NOTHING PERSISTS YET
  │  PixiJS renderer (canvas)    │
  └──────────────────────────────┘
```

### Why the clock is its own thing

Everything in the game is judged against **playback time**, never against
`performance.now()`. The audio source is the authority on where we are in the
song, and every source lies differently: YouTube's `getCurrentTime()` moves in
steps of a few hundred milliseconds, stalls while buffering, and jumps on a
seek.

`GameClock` interpolates between samples, corrects persistent bias by
**minimum drift** rather than mean drift — mean drift invents lag on a coarsely
quantised source — and hard-resyncs on a jump. Judging reads one number from
one place, and every playback source becomes the same shape behind
`PlaybackAdapter`.

### Why the engine has no idea what a browser is

`GameEngine`, `LaneJudge`, `ScoreSystem`, `GameClock`, `SongPlan`,
`ChartRecorder` and the analysis pipeline are pure functions over data. They
take a chart, a time and an input; they return judgments and scores. No DOM, no
canvas, no sockets.

That is what makes 244 tests possible without a browser or a webcam — and it is
also the honest limit of them, because three real bugs lived entirely in what
the browser decides: which element has focus, which element a click hits, and
what order two clients send messages in. See `PLAYTEST-FINDINGS.md`.

### Why the server is plain JavaScript

It runs under `node` directly with no build step, so `npm run serve` is the
whole story and there is no compiled artefact to go stale against its source.
The cost is real and named: it cannot import the TypeScript validator, so
validation has to be shared deliberately rather than by an import.

---

## Data

### A chart

The only thing this project stores. Note times and lanes — **never audio, not
one sample.**

```json
{ "schemaVersion": 1,
  "song": { "id": "youtube:7aMOurgDB-o", "title": "…",
            "playback": { "provider": "youtube", "videoId": "7aMOurgDB-o" } },
  "analysis": { "bpm": 174, "offsetMs": 0 },
  "arrows": [ { "id": "a0", "timeMs": 2400, "lane": "left", "type": "tap" } ] }
```

About 21 KB for a 366-arrow song. Small enough to send over the wire is the
property the whole multiplayer design rests on.

### Three identifiers

| | | |
|---|---|---|
| `songKey` | `youtube:7aMOurgDB-o` | which song |
| `chartId` | `youtube:7aMOurgDB-o#vero#v2` | which beatmap of it |
| `author` | `vero` | whose reading it is |

Versions count **per author**, so your v2 and someone else's v1 are separate
readings rather than a sequence. This replaced one-chart-per-song, under which
re-tapping destroyed the previous attempt.

### Where charts live

Today: `localStorage`, per browser **and per origin** — `localhost:5181` and
`veronicas-macbook-air.local:5181` are different stores. The server holds one
chart, the room's current pick, and forgets it when the room empties.

That is the thing currently being changed. See the plan: the server becomes the
shared library, charts are private until published, and `localStorage` becomes a
cache rather than the only copy.

---

## The network

One WebSocket per client, same host and port as the page, so opening the shared
address just works.

```
  C2S   join · chat · score · finish · ready
        pickSong · queueSong · trouble
  S2C   welcome · room · song · chat · round · error
```

Two decisions worth keeping:

**The chart travels in its own message.** `S2C.ROOM` goes out on every score
update — ten times a second per player — and a chart is tens of kilobytes.
Putting the chart in it was the difference between a few KB a minute and
megabytes. The same reasoning caps song titles, which do ride in `ROOM`.

**A round starts as a duration, not an instant.** Machines do not agree on the
time and would need synchronising before an absolute moment meant anything.
"Start in three seconds" means the same on every clock, and on a LAN the
difference in arrival is a millisecond or two.

---

## Share the hostname, not the IP

The server prints `http://<machine>.local:5181` as the address to share, and the
numeric address only as a fallback. This is not cosmetic.

**YouTube refuses to embed restriction-bearing videos on a bare IP origin.**
Measured, three runs each way, one video:

| Origin | Result |
|---|---|
| `http://localhost:5181` | plays, 3/3 |
| `http://veronicas-macbook-air.local:5181` | plays, 3/3 |
| `http://192.168.4.101:5181` | **error 150**, 3/3 |

An unrestricted control video played from all three, which is what makes this
the video's restriction meeting a non-domain origin rather than a network
problem. It also explains a real report exactly: the host was on `localhost`
and it worked; the guest was on the numeric address and it did not.

---

## State of play

**Done**

- Clock, judging, scoring, health, grades, timing offset with auto-suggestion
- Keyboard input, guarded so lane keys do not hijack text fields
- Chart authoring by tapping, with tempo fit and section plans behind admin mode
- Deterministic chart generation — seeded from the song id, so the same song
  always produces the same arrows
- PixiJS renderer: lane strip, receptors, room, wandering cats
- LAN multiplayer: rooms, chat, ready-up, synchronised start, live scoreboard
- Chart identity and versioning, with migration from the older format
- Security: origin check, path traversal, bounded input, round watchdog,
  sanitised titles, and a barrier that stops a handler throw killing the process

**In progress** — the shared chart library. Server-owned, on disk, private
until shared, owner-token deletion.

**Not built** — accounts, persistence beyond charts, playlists, power-ups,
progression, TLS, moderation tools. Named so they are decisions rather than
omissions.

---

## Why not Next.js

Asked directly, and worth writing down because the answer will look wrong later
if the reasoning is not attached.

Next.js is a framework for **rendering pages on a server**: routing, SSR, static
generation, API routes, streaming. This is a `requestAnimationFrame` canvas game
whose entire UI is one screen. There is nothing to server-render, no SEO
surface, and no page transitions.

The part that decides it: **Next.js has no first-class WebSocket story.** Its
API routes are request/response and its serverless deployment targets do not
hold long-lived connections. The realtime layer is the heart of this app, so it
would need a separate Node process anyway — which is precisely what exists now,
minus the framework.

Accounts, chat and sessions do not need it either. Those need a database, a
session store and an identity provider, all of which sit behind the current
server without changing its shape.

**When it would be right:** a public site around the game — profiles, a browsable
chart library, a landing page — where SSR, routing and SEO earn their cost. That
is a second application that talks to this one, not a rewrite of it.
