# Room loops

How a person moves through the game. This file is the directive for the
three pages and the two room types. If the UI disagrees with this page,
the UI is wrong — say so and change one of them.

Companion to `SYSTEM-DESIGN.md` (domain), `IMPLEMENTATION-PLAN.md`
(phases), and `ROOM-THEME.md` (chrome, tokens, plates). Where this file
is more specific about **pages and room behaviour**, it wins until we
write the disagreement down.

---

## Three pages

| Page | URL (working names) | What it is |
|---|---|---|
| **Home** | `/` or `/play.html` | Who you are, who dances, **our songs**, which room you walk into |
| **Rooms** | `/rooms` | Public rooms. Start with one. Cap 6. |
| **Create** | `/create` | One screen: paste a URL, set timing, draft or publish |

Home is not a room. It is the door. Create is not a room either. It
**hands you into** a room — Staging — when you save.

The two room **experiences**:

| Room | Who is in it | What it plays |
|---|---|---|
| **Public** | Anyone, up to 6 | The same songs Home lists, once they are published — shuffled |
| **Staging** | The author, and later anyone they invite | The chart that was just drafted or submitted for publish |

A room is still not a database (`SYSTEM-DESIGN.md` §19). Charts live in
Postgres. Who is here, what is on, and whether we are counting down live
in memory.

---

## 1. Home

**Purpose:** leave as a person who can be recognised, with a figure, into
a room that exists.

```
arrive
  → cookie identity is already a person (or one is minted)
  → set display name          (a label, not an account)
  → pick the figure           (cat or bunny)
  → pick a public room        (today: the one room)
  → see our songs             (the store — drafts and published)
  → Join
  → Public room (10 s buffer, then a song)
```

### What Home does

- **Name.** Same rule as now: the id is the cookie, the name is a label.
  Two people named Vero are two people.
- **Figure.** Cat or bunny. This is a costume, not a second identity.
- **Room.** A list of public rooms. Start with one. Show how full it is
  (`2 / 6`). If it is full, Join is disabled.
- **Songs.** Home is **our songs** — whatever is in the store. It is a
  library, not a request to the DJ. Tapping a song here does not put it
  on in the Public room. Public later **leverages those same songs**:
  the ones that are published get shuffled there. Drafts stay visible
  on Home and stay out of the shuffle.

### What Home does not do

- Create a room (not yet).
- Author a chart (that is Create).
- Start a countdown. Nobody is playing on Home.

---

## 2. Public room

**Purpose:** up to six people dance. The songs are the ones Home already
lists, filtered to published, shuffled. Home is the shelf; Public is
the dance floor using that shelf.

```
join (or land from Home)
  → if the room is at 6, refuse
  → if the room is idle (empty, or between songs)
       10 s buffer (a delay, ADR-002 — not a server timestamp)
       then the next shuffled published chart plays
  → if a song is already playing
       spectate: watch the room and the video
       no lane hits, no score
       the next buffer you can play
  → playing
       LaneRenderer + the dance sheet
       YouTube stays visible when the chart is YouTube
  → results
       own score, no public leaderboard
       ~4 s hold
  → next shuffled published chart
       another 10 s buffer
       no Ready
  → leave → Home
```

### Rules that are load-bearing

- **Capacity 6.** A seventh person sees the room as full.
- **Queue is a shuffle of our published songs.** Same store Home shows.
  Drafts are not in it. A song chosen on Home does not jump the line.
  Player picks do not append (this is the difference from
  `SYSTEM-DESIGN.md` §19's "everyone's pick goes on the queue").
- **Songs start themselves.** There is no Ready. The room is the DJ:
  a 10 s buffer, then the next shuffled published chart. A song chosen
  on Home still does not jump the line. Picking and starting as one
  button already broke a room once (`PLAYTEST-FINDINGS.md`).
- **Join mid-song is spectate.** You can chat and wander. You cannot
  play. The next buffer you are in the round.
- **One person's blocked video must not freeze the room.** Preflight
  stays: each client loads media and reports playable or not before
  countdown. A failure is visible. The room still starts for everyone
  who can play (`SYSTEM-DESIGN.md` §26).
- **The stage is `LaneRenderer`.** Do not build a second playfield.
- **Scores are claims.** The client reports them. No board that ranks
  strangers.
- **Chat is on.** Waiting and playing. The side panel from the
  prototype — not a new messenger. Typing must never be a lane
  (`KeyboardInput` already refuses keys inside a text field).

### Chat — reuse, do not rewrite

This already exists and has been paid for:

| Piece | Where | What it already gets right |
|---|---|---|
| Wire | `packages/protocol` `chat` | Bounded, cleaned, never empty; a client cannot mark itself `system` |
| Server | `server/index.mjs` + `rooms.mjs` | Speaker is the socket's player, never a name in the payload. 200 characters. History capped. Join/leave are system lines |
| Client | `src/net/useRoom.ts` + the side panel in `src/App.tsx` | One socket, chat in the room, reconnects alone |
| Input | `src/input/KeyboardInput.ts` | `isTypingTarget` — "d" in chat is not a right-lane hit |

Public room uses that. Do not invent a second chat. When rooms move onto
`apps/server`, this is the behaviour that moves — not a redesign.

Staging does not need chat to start. It is a dressing room.

### Empty room

Walking into an empty Public room starts the 10 s buffer. Solo is
allowed — it is how you check the shuffle without a second laptop.

If the last person leaves, in-memory room state may reset. The room
**listing** stays. It is a place, not a session.

---

## 3. Create (not a room)

**Purpose:** turn a YouTube URL into a draft or a publish-candidate,
without routing through a second form.

```
open Create
  → paste URL
  → Submit
       same page: the video embeds here
       title comes from the video, never a typed title field
  → set start time          (e.g. 0:06 → first beat at 6 s)
  → set BPM
       either type it
       or tap space while the video plays; BPM from those taps
  → Advanced accordion      visible, disabled, not a second page
  → Generate and test | Draft | Publish | Exit
```

### One page

Submit does **not** navigate. The player, the start field, the BPM
field, the tap-to-BPM control, and the three actions all live on this
configuration screen.

### Start time

A clock-style value (`0:06`, `1:12`). The first generated beat is at
that media time. Notes before it do not exist. This is a **chart
offset**, not player calibration (`SYSTEM-DESIGN.md` §13). It is written
into the revision.

### BPM

Two ways in, one number out:

| How | What happens |
|---|---|
| Manual field | The number is the BPM. |
| Space while playing | Each tap is a sample. BPM from the intervals, same rule as the engine already has (`60000 / median interval`). |

Switching methods overwrites the other. A typed 140, then four spaces
at 120, becomes 120. The field always shows the current number.

Taps are not a section map. They do not describe skipped passages. That
bug already shipped once (`PLAYTEST-FINDINGS.md`). Taps answer **how
fast**, plus a phase we can derive. Start time answers **where beat
one is**.

### Advanced

An accordion labelled Advanced Beatmap settings. It is **disabled**.
It is on the page so the later tools (holds, extra timing points, hand
edits) have a door. Opening it does nothing for now.

The editor *is* Staging unlocked (`CHART-EDITOR.md`): lanes beside
YouTube, a CapCut-style asset bin, a one-row timeline under both.
Public never gets that chrome. The lanes stay `LaneRenderer` — the
zoomed-in slice of the same chart.

### The actions

| Action | Persist | Playable in Public? | Next screen |
|---|---|---|---|
| **Exit** | Nothing new | — | Home |
| **Draft** | Yes, status `draft` | No | **Staging** |
| **Generate and test** | Yes, status `draft` | No | **Staging**, with Back and Regen |
| **Publish** | Yes, status `pending` (not public yet) | No, not until Staging says so | **Staging** |

Publish shows a note **before** it fires:

> This will not go into the public room yet. You will play it in
> Staging first.

That is the whole point of Staging. A publish click is a request, not
a listing.

---

## 4. Staging room

**Purpose:** play the chart you just saved, on the real stage, before
strangers can be handed it.

```
land from Draft or Publish
  → waiting
       you (and later, anyone you asked)
       the chart is this one — no shuffle
       Ready
  → 3 s countdown → playing → results
       same stage, same engine
       YouTube pause works — this is a workshop
  → after results
       Ready or Play again
       Regen beatmap   (new seed, same video and timing, stay here)
       Back to Create  (same URL, start, BPM)
       if you came from Draft or Generate and test:
            stay draft
       if you came from Publish:
            Publish to public   (now it is actually published)
            or keep as draft    (changed your mind)
  → leave → Home (or back to Create)
```

### Rules

- **One chart.** Staging does not shuffle. It is a dressing room, not a
  club.
- **Not in the Public shuffle** until a person who came from Publish
  confirms after a run. A draft that was only staged stays a draft.
- **Ready starts it.** Songs do not auto-play. Pause the video when you
  need to. Public locks the player; Staging does not.
- **Cap can be 1 for now.** Invites are later. The loop is written so a
  second person can sit in later without a new page.

### Why this room exists

A published chart is immutable (`SYSTEM-DESIGN.md` §6). Publishing is
the moment we stop being allowed to shrug. Staging is the last chance
to hear it on the same stage the Public room uses, before that lock.

---

## Shared stage, two loops

Same `LaneRenderer`. Different start rules. Do not merge them.

**Public**

```
join  →  10 s buffer  →  playing  →  results on the lanes  →  next chart
              ↑                                              |
              └──────────────────────────────────────────────┘
```

Mid-song joiners spectate. The room stays visible after a song —
stats sit on the lane strip, figures still wander, chat still works.

**Staging**

```
waiting  →  Ready  →  countdown  →  playing  →  results  →  Ready
```

- Countdown is a **delay from this machine**, not a shared wall-clock
  timestamp (ADR-002).
- Game Core still takes a number. The adapter is the clock.
- Figures are the dance sheets, on `LaneRenderer`. No second playfield.
- YouTube stays visible. A `.local` hostname, never a bare IP.

---

## Out of scope until this file says otherwise

- More than one public room
- Player-built queues or voting
- OAuth
- Advanced beatmap fields
- Inviting people to Staging
- A public leaderboard
- Server-side judging

---

## What this changes in the older docs

| Older rule | Here |
|---|---|
| §19: one screen is lobby + browser + queue + play | Three pages. Play still happens *in* a room, on the existing stage. |
| §19: every pick appends to the queue | Public room shuffles published charts. |
| §14: URL → tap → generate → draft → publish | Same ingredients, one page, and **Staging before public.** |
| Phase 4 `play.html` is library + solo | Home is the door **and** our song list. Solo is you, in Public, alone. Public shuffles those songs once published. |
