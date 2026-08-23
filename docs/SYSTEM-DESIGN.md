# Neko Dancer — System Design

**Status: the contract.** This document is the *what* and *why*. Its companion,
`IMPLEMENTATION-PLAN.md`, is the *who, where, and how we prove it works*.

Authored by Vero. Anything in the codebase that contradicts this document is a
defect in the codebase, unless it is recorded as an accepted deviation in
`IMPLEMENTATION-PLAN.md` § Architecture decisions.

---

## 1. Product definition

An online DDR-style rhythm game built around WASD rhythm gameplay, YouTube-backed
songs, user-created beatmaps, a global beatmap library, user accounts, personal
playlists, multiplayer rooms, multiplayer song queues, and room chat.

The architecture prioritises **reliable rhythm gameplay first**. Multiplayer
orchestrates the same gameplay engine used by single-player rather than creating
a second gameplay implementation.

## 2. Core architecture

```
                         NEKO DANCER

┌───────────────────────────────────────────────────────┐
│                   React Client                        │
│  Application                                          │
│  ├─ Login          ├─ Chart Creator                   │
│  ├─ Global Beatmaps├─ Single Player                   │
│  ├─ My Library     └─ Multiplayer Room                │
│                                                       │
│  Game Core                                            │
│  ├─ timing engine  ├─ scoring                         │
│  ├─ note renderer  ├─ combo                           │
│  ├─ input handling ├─ judgments  └─ calibration       │
│                                                       │
│  Playback Layer   └─ YouTubeAdapter                   │
│  Realtime Client  └─ WebSocket                        │
└──────────────────────────┬────────────────────────────┘
                       HTTPS / WS
┌──────────────────────────▼────────────────────────────┐
│                    Neko Server                        │
│  API                         Realtime                 │
│  ├─ users                     ├─ rooms                │
│  ├─ songs                     ├─ players              │
│  ├─ beatmaps                  ├─ queue                │
│  ├─ chart revisions           ├─ ready state          │
│  ├─ playlists                 ├─ round state          │
│  ├─ tags                      ├─ synchronized start   │
│  └─ search                    └─ chat                 │
│                     PostgreSQL                        │
└───────────────────────────────────────────────────────┘

YouTube ├─ metadata ├─ video playback └─ playback clock
```

**Neko Dancer stores game data, not media files.** The server does not download
or redistribute YouTube audio or video. Each client independently loads the same
media source.

## 3. Technology stack

**Client:** Vite · React · TypeScript. Keep Vite. Next.js is not required simply
because the project now has accounts or a database — the core game is
client-heavy (`requestAnimationFrame`, keyboard input, video playback, precise
timing, WebSocket state) and SSR provides no meaningful benefit to the gameplay
loop. Routing via React Router or TanStack Router.

**Server:** Node.js · TypeScript · Fastify · Socket.IO or native WebSocket.
REST handles persistent resources; WebSockets handle transient realtime state.

**Database:** PostgreSQL, via **Supabase** (hosted Postgres + Auth + tooling).
Drizzle as the ORM. Supabase *is* PostgreSQL — they are not competitors.

Postgres is authoritative for: users, songs, beatmaps, chart revisions,
playlists, favorites, tags, scores.

> **Filesystem JSON and `localStorage` must not be authoritative persistence.**
> `localStorage`/IndexedDB may cache downloaded charts.

**Authentication** arrives in the foundation phase and provides a stable
`userId` and `displayName`. Ownership becomes `beatmap.authorId = user.id`
rather than a browser ownership token.

## 4–6. Domain model

The most important architectural distinction:

```
Song  →  Beatmap  →  ChartRevision
```

These must not be treated as the same object.

```ts
Song {          // external media
  id                      // internal, independent of YouTube's id
  provider                // "youtube"
  providerMediaId         // "abc123"
  title; artist; durationMs; thumbnailUrl; createdAt
}

Beatmap {       // someone's playable interpretation of a song
  id; songId; authorId
  title?; difficulty; tags[]
  status; currentRevisionId
  createdAt; publishedAt?
}

ChartRevision { // the actual rhythm gameplay
  id; beatmapId
  schemaVersion; revision
  timing; notes
  generatorVersion?; generatorSeed?
  createdAt
}
```

One song has many beatmaps; one beatmap has many revisions.

```
Song — Rain On Me
├─ Beatmap by Vero          ├─ Revision 1  └─ Revision 2
└─ Beatmap by another user  └─ Revision 1
```

**Published revisions are immutable.** Editing a published chart creates another
revision.

## 7. Timing data

A chart needs more than BPM. At minimum `{ bpm, offsetMs }`.

BPM determines how far apart beats occur; offset determines where the grid
starts. 120 BPM is a beat every 500 ms — but the beats may fall at 237, 737,
1237, 1737 ms. **Both must be calculated during chart creation.**

Evolves later into timing points without redesigning anything else:

```ts
timingPoints: [
  { timeMs: 0,     bpm: 128 },
  { timeMs: 92000, bpm: 132 },
]
```

Ultimately a `TimingPoint { timeMs, bpm, beat }`, which can re-anchor a drifting
recording at a later beat rather than piling `initialOffset` / `middleOffset` /
`laterOffset` onto one chart.

## 8. Notes

**Persist the actual generated notes.**

```ts
Note { id; timeMs; lane; type: "tap" | "hold"; durationMs? }
```

Do not rely solely on regenerating from `songId + seed`. The algorithm will
change; persisted notes guarantee a published beatmap keeps playing exactly as
its creator published it. Seed and generator version are kept for debugging and
reproducibility only.

## 9. Game Core

A standalone TypeScript package (`packages/game-core`) with **no dependency on
React, YouTube, WebSockets, the database, or rooms.**

Receives: chart · current media time · player input · calibration.
Produces: note positions · judgments · combo · score · round state.

The same engine powers single player, chart testing, multiplayer, and future
replay/spectator systems.

## 10. Playback clock

The media clock is authoritative.

```
note position = (note.timeMs - currentMediaTime) × scrollSpeed
```

**Do not move notes by adding pixels each frame** — a dropped frame becomes
permanent drift. Derive the exact position from media time every frame, and the
game catches up automatically after a missed frame.

## 11. Playback abstraction

Game Core must not depend on YouTube directly.

```ts
interface MediaProvider { resolve(input: string): Promise<MediaSource> }

interface PlaybackAdapter {
  load(source: MediaSource): Promise<void>
  play(): void; pause(): void; seek(ms: number): void
  currentTimeMs(): number
  isReady(): boolean; isPlaying(): boolean
}

MediaSource { id; provider; providerMediaId; title; creator?; durationMs?; thumbnailUrl?; bpmHint? }
```

`YouTubeProvider → MediaSource → YouTubePlaybackAdapter`. Only YouTube is
implemented initially. A provider's `bpmHint` is a **suggestion**; the chart
still owns the timing map, because an external BPM does not say where beat 1 is.

## 12. Scoring

Lives inside Game Core. A judgment classifies the difference between the note's
expected time and the keypress.

```ts
judgementWindows = { perfect: 45, good: 90, okay: 140, miss: 180 }
```

Values are tuned by playtesting, not treated as final architecture.

> **Player input never adjusts the song or chart during normal gameplay.** If
> the player taps early, the music continues, the chart continues, and the
> judgment reflects the early hit. Nothing compensates automatically.

## 13. Three different offsets — never mix them

| Offset | Question | Stored |
|---|---|---|
| **Chart offset** | Where does the musical beat grid begin? | With the chart |
| **Player calibration** | Does this player's keyboard/display feel early or late? | User/device preference — never modifies a published chart |
| **Multiplayer start** | When should every client begin the round? | Temporary room state |

## 14–15. Beatmap generation and Chart Creation Mode

```
Paste YouTube URL → load song → choose/sample a section → user taps the beat
→ calculate BPM → calculate offset → generate notes → test chart
→ save draft → publish
```

BPM from tap intervals via a robust average/median; `BPM = 60000 / beatIntervalMs`.
Taps also estimate beat phase/offset.

**Chart Creation Mode may behave differently from gameplay.** During testing it
may detect "you consistently hit this chart about 58 ms early" and offer to
shift the chart timing — an explicit chart edit. **Normal gameplay must never
perform this correction.**

Manual note editing, holds, combo patterns, difficulty shaping, subdivisions,
multiple timing points and manual timing correction are later work.

## 16–18. Library, Save vs Fork, Playlists

**Global** is a database-backed catalog, searchable by song, artist, author,
difficulty and tags. A song exposes all its published beatmaps. It stores song
metadata + beatmap metadata + chart revision data — never duplicated media.

**Save creates a reference**, not a copy: `UserLibrary { userId, beatmapId, savedAt }`.
To modify someone else's beatmap, **Fork** creates a new Beatmap with its own
ownership and revision history.

**Playlists reference charts, they do not own them:**
`Playlist { id, userId, name }` + `PlaylistItem { playlistId, beatmapId, position }`.

## 19–21. Rooms, room UX, ready state

```ts
Room { id; players[]; queue[]; activeBeatmapRevisionId?; roundState }
```

**A room is not a database.** Persistent beatmaps live in Postgres; room state
lives in memory.

One screen contains player list, chat, song browser, queue and ready controls —
no separate matchmaking → selection → lobby → gameplay sequence. If several
players choose different songs, **append all of them to the queue**; nothing
needs to resolve a voting conflict.

The current queued song becomes eligible when every participating player is
ready. After the round: remove the first queue item, the next becomes active,
players ready again.

## 22–25. Multiplayer distribution, start, judgment, score

**Do not transmit media through the WebSocket server.** The server sends
identifiers:

```ts
ROUND_PREPARE { beatmapRevisionId: "revision_123" }
ROUND_START   { beatmapRevisionId: "revision_123", startAt: serverTimestamp }
```

Each client retrieves the beatmap, revision, song and `providerMediaId`, and
loads the video itself.

**Judgment uses the player's own media clock**, their calibration and the shared
revision — never the server wall clock, because differences in YouTube startup
would otherwise unfairly change timing.

```
server decides WHEN the round starts
client media clock decides WHERE the music currently is
```

Clients broadcast `PLAYER_PROGRESS { score, combo, accuracy }`. The server does
not initially validate every keystroke; server-authoritative validation can come
later if cheating becomes relevant.

## 26. Video preflight

```
Room selects beatmap → every client attempts to load the media
→ each client reports READY / MEDIA_ERROR
```

A media failure must not freeze the room indefinitely. Policy for a failed
player may become skip / spectate / drop from the ready requirement — but **the
failure must be detected before gameplay starts.**

## 27–28. Chat and room identity

The server knows which authenticated user owns the socket.

```ts
// client sends
SEND_CHAT { text: "hi" }
// server produces
CHAT_MESSAGE { userId, displayName, text, sentAt }
```

**Never accept a username from the client.** On joining, a room takes a
participant snapshot `RoomPlayer { userId, displayName }`; the display name
cannot change while that user remains in the room.

## 29. Local storage

Good uses: volume, key bindings, visual preferences, calibration, recent
searches, cached IDs. IndexedDB may cache larger chart payloads. **Authoritative
copies remain on the server.**

## 30. Corrections to the previous architecture

The previous design correctly diagnosed that charts existed only in one
browser's `localStorage` and could not form a shared catalog.

- **Replace** `charts/` JSON files + in-memory index **with PostgreSQL**.
- **Replace** the browser `ownerKey` **with authenticated user ownership**.
- **Keep** chart versioning: multiple charts of one song must coexist, and
  re-charting must not destroy earlier work.
- **Replace** constructed ids like `youtube:<video>#<user>#v2` **with generated
  database ids**. Song, beatmap, author and revision identity stay separate.
- **Keep** the lobby video preflight.

## 31. Implementation order

1. Freeze architecture-changing feature work; establish domain contracts.
2. Extract Game Core (pure TypeScript).
3. Lock timing behaviour.
4. Create the playback abstraction.
5. Build Postgres persistence.
6. Add basic authentication.
7. Complete single-player.
8. Build simple chart creation.
9. Build Global browsing.
10. Add multiplayer orchestration.
11. Add advanced creator tools.

## 32. Architectural rule

```
Song → Beatmap → ChartRevision → Game Core → PlaybackAdapter
```

Single-player uses it. Chart testing uses it. Multiplayer uses it. Future
replay/spectator uses it.

**Multiplayer is Game Core + room orchestration + realtime player state — not
another implementation of the rhythm game.**
