# Diagnosis — "the uploader does not allow this video outside YouTube"

Written before changing anything, because the last three rounds of this were
guesses and two of them were wrong.

---

## The short answer

**The song IS reaching the other player. Nothing is broken in the game.** The
video is refusing to embed for them, and the game is correctly reporting it.

The screenshot proves the distribution works: their screen shows the title, the
arrow count, the BPM, `v1`, and *picked by mazzystix*. A client that had not
received the chart could not render any of that.

What fails is the next step — asking YouTube whether **this** browser may play
**this** video — and that is a question about the video and the origin, not
about our code.

---

## The flow, with line numbers

Follow it in this order; step 3 is where it dies.

| # | What happens | Where |
|---|---|---|
| 1 | Picker sends the whole chart | `server/index.mjs:395` (`PICK_SONG`) |
| 2 | Server stores it, broadcasts to everyone | `server/index.mjs:427` (`S2C.SONG`) |
| 3 | Each client receives it | `src/net/useRoom.ts:171` |
| 4 | …validates and stores it locally | `src/App.tsx:490` (`acceptRoomChart`) |
| 5 | **Each client asks YouTube if it can play it** | `src/App.tsx:468` → `src/playback/YouTubeAdapter.ts:172` |
| 6 | The answer goes back to the room | `src/App.tsx:473` (`CAN_PLAY`) → `server/index.mjs:459` |
| 7 | Room marks them unable, excludes them | `server/rooms.mjs:208`, `:245` |
| 8 | Their screen shows the red line, ready is disabled | `src/App.tsx` lobby |

**Steps 1–4 are working.** Step 5 returns error 150.

---

## What I measured

### The preflight is honest — it is not producing false negatives

My first suspicion was our own code: `checkVideoPlayable` mounts a **1×1,
`opacity: 0`, off-screen** player (`YouTubeAdapter.ts:188`), which is not how
the real player is mounted. A hidden player is exactly the sort of thing YouTube
treats differently, so a false "cannot play" was plausible.

**Disproven.** Same video, same origin, three mount styles:

| Origin | hidden 1×1 | visible 320×180 | small visible |
|---|---|---|---|
| `veronicas-macbook-air.local:5181` | ok | ok | ok |
| `192.168.4.101:5181` | **error-150** | **error-150** | — |

The preflight agrees with the real player in both directions. When it says
someone cannot play, they cannot play.

### The origin is the variable, for this class of video

Control video (unrestricted) on the same runs: **ok on both origins**. So the IP
is not broken in general — it is specifically that a **bare IP is not a domain**,
and YouTube refuses restriction-bearing videos on one.

---

## So why are other players still seeing it?

Two possibilities, and **I cannot tell them apart without one piece of
information I do not have: the video id.**

**(a) They are still on the IP link.** The server only started recommending
`http://veronicas-macbook-air.local:5181` recently. Anyone using the numeric
address, or a bookmark from before, hits the restricted case every time.

**(b) That particular video is blocked everywhere.** "Tokyo Ghoul Opening |
Unravel by TK from Ling Toshite Sigure" is a commercial anime opening. Official
label and anime uploads are among the most commonly embed-restricted content on
YouTube, and for those, *no origin helps*.

**The test that separates them:** open the song on
`veronicas-macbook-air.local:5181`. If it plays there and not on the IP, it is
(a) and the fix is the link. If it fails on both, it is (b) and the fix is a
different upload.

---

## The uncomfortable part

If (b) — and for a commercial anime opening it very likely is — then the problem
is not a bug to fix. **It is that YouTube is a hostile foundation for the exact
songs people most want to chart.** The more popular and more official the
upload, the more likely it refuses to embed.

That does not kill the design; §22 is still right that the server should never
touch media. But it changes what "working multiplayer" needs:

1. **Charting must check embeddability at creation time**, not at round time.
   Charting a song nobody else can play is wasted work, and the current flow
   only finds out when everyone is already in the lobby waiting.
2. **The library should record it.** `Song` can carry an `embeddable` flag from
   the last check, so the browser can warn before anyone picks.
3. **There should be a media source that cannot fail.** See below.

---

## Answers to the three questions

### "Is the other user just not getting the song sent over to them?"

**No.** They have it. The screenshot renders data that only exists inside the
chart. Chart distribution has worked since the `S2C.SONG` fix; this is a
different failure wearing the same coat, which is why it looks like the old bug.

### "Do we need a DB before we test multiplayer?"

**No.** The database is for the *library* — persistence, browsing, ownership,
playlists. Rooms, ready state, countdown, synchronised start and scoring are all
in-memory and would behave identically with Postgres behind them.

Adding a DB now would not move this failure by a millimetre, because the failure
is between a browser and YouTube.

### "What counts as a passing test for multiplayer?"

Honest answer first: **my definition has been too narrow, and that is why the
suite has been green while the game was unplayable for your friends.** 1140
tests pass and not one of them can see this bug. That is the same pattern
`PLAYTEST-FINDINGS.md` already records twice — *the tests were correct and the
game was broken* — and I did not apply the lesson to my own definition of done.

There are five rungs, and only the first three are automatable:

| Rung | Proves | Automated? |
|---|---|---|
| 1. Protocol | messages, ordering, state transitions, isolation | ✅ today |
| 2. Engine | judgment, scoring, timing, three-clocks | ✅ today |
| 3. Failure matrix | disconnects, doubles, stale replies, aborts | ✅ mostly |
| 4. **Media reality** | this video plays, in that browser, on that origin | ❌ never |
| 5. **Two humans** | it is fun, it feels synchronised, it is legible | ❌ never |

**A multiplayer feature is not "passing" at rung 3.** It is passing when you and
one other person, on two machines, complete a round together — and every failure
so far has lived at rung 4 or 5. So the definition of done for anything
multiplayer is: rungs 1–3 green **and** one real two-machine round, with the
result written into `PLAYTEST-FINDINGS.md`.

What CAN be automated at rung 4 is narrower but real: a smoke test that loads
one known-good video and one known-blocked video through the real
`YouTubeAdapter` and asserts we report each correctly. That catches *our*
handling regressing. It cannot catch YouTube changing its mind about a video,
and nothing can.

---

## Plan

Ordered by what unblocks playing together soonest, not by size.

### 0. Establish which case this is — you, five minutes

Open the song on `http://veronicas-macbook-air.local:5181`. Tell me whether it
plays. Everything below branches on the answer, and I am not going to build for
both.

### 1. Take YouTube out of the multiplayer test — small, high value

`~/Desktop/code/copyright-free music/` has four mp3s and the schema already
supports a `localAudio` provider. Served by your own server, both machines fetch
byte-identical audio with **no embedding, region or age restriction possible.**

This is the change I would make first. It means the next time multiplayer
breaks, you are debugging your game rather than YouTube's policies — and right
now you cannot tell those apart, which is precisely the position we have been
stuck in for three rounds.

### 2. Check embeddability when charting, not when playing — medium

Run the existing `checkVideoPlayable` at the point a song is added. If it fails,
say so before ten minutes of tapping. Record the result on the song so the
library can mark a chart *"may not play for everyone"*.

This is the real product fix for (b), and it is the same function already
written — moved earlier in the flow.

### 3. Make the link unmistakable — small

The banner recommends the hostname, but a bookmark does not read banners. Show
the current origin in the lobby, with a warning when it is a bare IP: *"you are
on a numeric address; some videos will not play. Use
veronicas-macbook-air.local:5181."*

### 4. A rung-4 smoke test — small

One known-good and one known-blocked video through the real adapter, asserting
we classify both correctly. Guards our handling; cannot guard YouTube.

### Not now

A database. Storybook. Anything in Phase 3+. None of them touch this.
