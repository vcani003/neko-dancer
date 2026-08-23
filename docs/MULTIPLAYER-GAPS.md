# What is missing from multiplayer

Prompted by: *"when everyone is ready, we should all play together — why do we
each have to hit play independently?"*

The answer to that one is a bug with a one-line cause. The rest of this is the
list it exposed.

---

## The immediate bug: the Play button ignores the room

`src/App.tsx:765`

```tsx
<button className="button--primary" onClick={start}>Play</button>
```

Ungated. Always visible in the menu, whether or not you are in a room, and
`start()` begins a **solo run immediately** — it does not tell the room, does not
wait for anyone, and does not care that a countdown may be running.

The auto-start path exists and works. The server counts down and broadcasts
`playing`; every client's effect calls `startRef.current()`. That is fine. But
sitting next to the countdown is a large pink button labelled **Play**, and of
course people press it. Pressing it starts your own private run, three seconds
out of step with everyone else's.

**In a room there should be no independent start at all.** Ready is the
commitment; the server decides when. The same applies to *Play again* on the
results screen (`:889`), which is solo-only for the same reason.

This is the whole of the reported symptom. It is small. Everything below is what
looking at it turned up.

---

## The gaps, in the order they hurt

### 1. There is no such thing as a mode

One screen does single-player and multiplayer at once, and the two contradict
each other. The Play button is a single-player affordance. The ready bar is a
multiplayer affordance. They sit four inches apart and disagree about who is in
charge of starting.

Every multiplayer game solves this by making it explicit: you are in a lobby, or
you are playing alone. Until that exists, every other fix here is patching over
an interface that is telling people two different things.

### 2. Ready is not a commitment

Everywhere else, ready means *"start when everyone has said this"*. Here it
means "set a flag, and also you can leave at any time by pressing the other
button". Nothing enforces that a readied player is actually going to play.

### 3. Results are private

`endRound()` (`server/rooms.mjs:303`) sets `results` and awards sushi, and the
results screen renders **nothing about anyone else** — no ranking, no comparison,
no winner. Two people finish a song together and each sees only their own card.

**A multiplayer round with no shared scoreboard is not a multiplayer round.** It
is two solo runs that happened to start at the same time. This is probably the
single largest gap on the list, because it is the entire payoff of playing
together.

### 4. Nothing happens after the round

The room reaches `results` and stops. There is no queue advancement, no "next
song", no re-ready. System design §21 specifies it — *remove the first queue
item, the next becomes active, players ready again* — and `Room` has no queue at
all beyond an unused `playlist`.

So a session is: pick, ready, play once, and then everybody sits there.

### 5. Nobody waits for the video to load

This is the sync gap, and it is the one that will make rounds *feel* wrong even
after everything above is fixed.

The preflight answers *"is this video allowed to play for me?"* It does not
answer *"is it loaded and ready to play from zero?"*. The countdown starts the
instant everyone is ready, so a player whose video is still buffering starts
late and loses the first bars.

§22–23 already describe the right shape and we skipped a step:

```
ROUND_PREPARE  →  everyone loads the media
               →  everyone reports ready
ROUND_START    →  only then
```

We go straight from ready to countdown. The `roundPrepare` message and
`PREFLIGHT_TIMEOUT_MS` exist in `packages/protocol` and are unused.

### 6. A countdown cannot be cancelled

If the last able player leaves during the count, everyone else counts down to a
round that will not happen. `roundAbort` exists in the protocol (Phase 0) and
nothing sends it.

### 7. Nobody can spectate

A player excluded because their video will not load sits in the lobby looking at
a static screen while their friends play. §26 lists spectating as one of the
three acceptable policies and it is the only one that is not rude.

The same hole covers joining mid-round: a late joiner lands in a room that is
`playing`, cannot ready, and has nothing to look at.

### 8. Disconnects are invisible mid-round

The watchdog stops the room hanging, which is a server-side protection. On
screen, a player whose friend closed their laptop sees a scoreboard that simply
stops moving. `connected` exists on `RoomPlayer` in the protocol; the app does
not use it.

### 9. Finishing early is a dead end

Finish a song before the others and you wait, with no indication of what you are
waiting for or how long is left.

### 10. Nobody is in charge

Anyone can pick a song at any moment, which un-readies everyone. There is no
host, no skip, no kick, no "stop changing the song". Fine among three friends,
untenable in a public room, and §19–21 assume a room that outlives one song.

### 11. Nothing confirms you are in sync

Two clients can be a beat apart with no way to notice except by feel. A visible
indicator — even just each player's media time in the sidebar during a round —
turns "it felt off" into something reportable.

---

## Proposed order

Grouped by what each group buys.

### P0 — makes a round actually shared. Small.

1. **Remove the independent start in a room.** In a room, the Play button is
   replaced by the ready control. Solo play is reachable only when not in one,
   or from an explicit "play alone" action. *(the reported bug)*
2. **Shared results.** The results screen shows every player, ranked, with
   score, accuracy and max combo. `endRound` already computes a scoreboard;
   `RoundScore` already exists in the protocol.
3. **Back to the lobby.** After results, everyone returns to the room and
   un-readies. Even without a queue, this makes a second song possible.

That is the minimum for "we played a song together", and it is a day's work
rather than a phase.

### P1 — makes it feel synchronised. Medium.

4. **Prepare before countdown.** Use `roundPrepare` and `PREFLIGHT_TIMEOUT_MS`
   as designed: everyone loads, everyone reports, then the count starts.
5. **`roundAbort`** when the round can no longer happen.
6. **Show `connected`** — mark a player who has dropped rather than freezing
   their score.

### P2 — makes it a place rather than a session. Larger.

7. **The queue** (§19–21): add, remove, advance after each round.
8. **Spectating**, which also covers late join.
9. **Host powers** — whoever created the room can skip and remove.
10. **A sync readout** during play.

---

## Where this sits against the phases

P0 and P1 are `apps/web` and `server/` work on the current prototype. They are
*not* Phase 7 — Phase 7 rebuilds this properly on the new contracts, and the
protocol already has `roundAbort`, `participating`, `connected`,
`PREFLIGHT_TIMEOUT_MS` and `QueueItem` waiting for it.

The question is whether to fix P0 in the prototype now so the game is playable
this week, or leave it and let Phase 7 do it once. **P0 in the prototype**, on
the grounds that a game nobody can play together does not get playtested, and
playtesting is the only thing that finds rung-4 and rung-5 problems.

P2 waits for Phase 7. Building a queue twice would be silly.
