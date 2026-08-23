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

## RESOLVED — it is the link, not the video

I had been asking for the video id to separate two cases. I already had it.

`7aMOurgDB-o` — the link supplied earlier in this session — **is** the Tokyo
Ghoul video. YouTube's oEmbed endpoint returns its title, and it matches the
chart in the screenshot exactly:

    7aMOurgDB-o  HTTP 200  Tokyo Ghoul Opening | "Unravel" by TK from Li…

So the measurements already taken are measurements of the failing song:

| Origin | This exact video | Runs |
|---|---|---|
| `http://localhost:5181` | **plays** | 3/3 |
| `http://veronicas-macbook-air.local:5181` | **plays** | 6/6 (hidden, small and visible mounts) |
| `http://192.168.4.101:5181` | **error 150** | 5/5 |

**The uploader has not disabled embedding.** The video embeds perfectly well.
It refuses on the numeric address because **a bare IP is not a domain**, and
YouTube evaluates a restriction-bearing video against the origin it is asked to
play in.

That is the entire bug. Everyone seeing this message is on the IP link.

### Why the error message is misleading, and that is partly our fault

Error 150 means "not allowed in this embed context". We render it as *"the
uploader does not allow this video to play outside YouTube"* with the hint
*"nothing here can change that — pick a different upload"*. For a
genuinely-disabled video that is right. For an origin rejection it is **wrong
and actively misdirecting** — it sends you hunting for a different upload when
the fix is a different URL.

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

## The real problem, stated properly

**YouTube will not embed restriction-bearing videos on an origin that is not a
domain name.** Our development setup serves the game from a bare IP, so we hit
it constantly — and it will hit *every* friend joining over the LAN by address.

This is not a property of the video, the chart, the room or the protocol. It is
a property of the URL people open. And it has a permanent fix, because the game
is not supposed to live on a LAN IP forever — §1 says *you play against the
whole world*.

Everything below is about giving the game a **domain**.

---

## Solutions — pick one for now, one for later

### A. The mDNS hostname — works today, zero effort

`http://veronicas-macbook-air.local:5181`. Measured playing this exact video
6/6. macOS publishes it; macOS and iOS resolve it natively; Windows has since
version 1803.

- **Cost:** none. Already implemented and already printed by the server.
- **Risk:** resolution is the whole question. Some Windows setups, most Android,
  and many corporate or guest networks do not do mDNS. If a friend cannot
  resolve it, they are stuck on the IP and back to square one.
- **Verdict:** try this first tonight, because it takes thirty seconds. It is
  not a foundation.

### B. Tailscale — a stable name, and it works off the LAN

Tailscale gives each machine a DNS name (`vero-air.tailnet-xxxx.ts.net`) that
resolves anywhere, on every OS, without touching a router.

- **Cost:** an install on both machines, no code changes.
- **Gain:** a real hostname, and your friends no longer need to be in the house.
- **Risk:** they have to install something. That is a real ask for a friend who
  just wants to play a game.

### C. A tunnel to a real domain with HTTPS — the strongest short-term fix

`cloudflared tunnel --url http://localhost:5181` hands back a public
`https://<random>.trycloudflare.com`. A genuine domain, genuine TLS, works from
anywhere, nothing to install for whoever joins.

- **Cost:** one command, one dependency on your machine.
- **Gain:** removes the origin class of failure **permanently**, and removes
  "are you on the right link" as a question. HTTPS also puts us on the same
  footing as every other site YouTube embeds on.
- **Risk, and it is the real one:** it puts the server on the public internet,
  and `SECURITY.md` is explicit that it is not ready for that — no
  authentication, client-reported scores, and rate limits sized for friends
  rather than strangers. The URL is unguessable and temporary, which is
  mitigation rather than security.
- **Verdict:** the best answer for *playing together this week*, if you accept
  that the URL is a secret and you stop the tunnel afterwards.

### D. Deploy it properly — the destination

Client on Pages or Vercel, server on Fly/Railway/Render, one domain, HTTPS.

- **Cost:** real. It needs auth (Phase 6) and the §4 security work before it
  should hold strangers.
- **Gain:** the origin problem never returns, and it is where the project is
  going regardless.
- **Verdict:** this is the answer. It is Phase 3–6, not tonight.

### E. Fix the misleading error — small, and independent of the above

Error 150 is rendered as "the uploader does not allow this video outside
YouTube", which is one of its two meanings. When the page origin is a bare IP,
say the other one:

> This address is a number, not a name. YouTube blocks many videos on numeric
> addresses. Open `http://veronicas-macbook-air.local:5181` instead.

We sent you hunting for a different upload when the fix was a different URL.
That is our error message doing damage, and it is a twenty-line fix.

### F. Warn before anyone charts — small, complementary

Show the origin in the lobby and warn when it is numeric, and run the existing
`checkVideoPlayable` when a song is **added** rather than when it is played, so
nobody taps for ten minutes against a song their friends cannot hear. Records
the result on the song for the library.

Worth doing whichever of A–D you choose, because genuinely embed-disabled videos
do exist and this is what catches them.

---

## What "done" means for this, restated in your terms

> Both players play the same map, from YouTube, to the end.

That is rung 5, and it is the only rung that counts here. My recommendation for
getting there fastest:

1. **Tonight:** A (hostname). If your friend cannot resolve it, C (tunnel).
2. **This week:** E and F, so the failure can never present as a mystery again.
3. **Phase 3–6:** D, which retires the problem.
