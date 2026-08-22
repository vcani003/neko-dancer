# Playtest findings

Bugs found by playing rather than by reading, with who found them and what the
underlying cause turned out to be. Kept because the pattern in these is worth
more than any individual fix — and because several of them no test would ever
have caught.

---

## 1. Lane keys made the text fields unusable

**Found by:** Vero, first session with chat.

> "since arrow keys and wasd is keybinded, i cant use those keys on username or
> chat messages! lol"

**What was happening.** `KeyboardInput` listened on `window` and called
`preventDefault()` on every lane key. Lane keys are WASD and the four arrows —
which is most of what anyone uses inside a text box: the letters themselves,
and the arrows to move the cursor. Every one of them was being swallowed before
the input element saw it.

**The half nobody had noticed yet.** The same handler also *judged* those
presses. Typing "d" in chat during a song fired a right-lane hit, and typing a
word could break a combo or drain health. The reported symptom was the smaller
of the two problems.

**Fix.** Keydown returns immediately when the event target is an `input`,
`textarea`, `select` or anything `contentEditable` — checked *before* the lane
lookup, so a typed key is never even considered gameplay input.

Keyup is deliberately **not** guarded the same way: focus can move between
press and release — click into chat mid-press and the keyup lands there — and a
lane left stuck "held" would light its receptor forever.

**Why no test caught it.** Every existing test called the engine directly.
Nothing exercised a real key event travelling through a real DOM with focus
somewhere. The tests were correct and the game was broken, which is the whole
argument for playing the thing.

---

## 2. The Play button could not be clicked

**Found by:** Vero, same session, one message later.

> "also i cant press play"

**What was happening.** PixiJS appends its canvas to the container element,
which places it *after* the React children in DOM order and therefore on top of
them. The canvas covered the entire overlay and absorbed every click, including
Play. Nothing was broken in React; the button simply never received the event.

**Fix.** `pointer-events: none` on the canvas — it is drawn, never clicked —
plus explicit `z-index` on the HUD, overlay and progress bar so stacking is
stated rather than inherited from DOM order.

**The annoying part.** hop//beat had exactly this rule, for exactly this
reason, and it did not survive being carried across to a new renderer. A fix
that lives only in CSS in another project is a fix that gets lost — which is
why the rule now has a comment next to it explaining *why* it exists, not just
what it does.

---

## 3. The other player never got the song, and ready never started anything

**Found by:** Vero, first two-machine session.

> "The other user is not able to get the song when both hit 'ready'. The other
> user does not see the song i set available. that should be shareable on my
> network"

Two separate bugs behind one report.

**The song was never actually sent.** The room broadcast carried a *summary* of
the chosen song — title, id, arrow count — while the menu was rendered from the
local chart store. So the other player saw their own charts and nothing else,
and the chart itself only travelled later, bundled with the countdown. A song
you cannot see is a song you cannot agree to play.

Fixed by giving the chart its own message, sent when the pick changes and to
anyone who joins afterwards. Deliberately *not* folded into the room broadcast:
that goes out on every score update, ten times a second per player, and a chart
is tens of kilobytes. The same data in the wrong message is a different feature.

**Ready could never complete.** The ready button sent the pick as well:

```tsx
if (!me?.ready) room.send(C2S.PICK_SONG, { chart });
room.send(C2S.READY, { ready: !me?.ready });
```

and picking un-readies the room, correctly — agreeing to play one song is not
agreeing to play whatever it was changed to. So the second player to press
ready silently un-readied the first, `everyoneReady()` was never true, and the
countdown could not fire however many times either of them pressed it. With one
player it worked perfectly, which is why it survived to a two-machine test.

Fixed by making picking its own action. The button now sends `ready` and only
`ready` — verified by watching the socket rather than by reading the code.

**Why no test caught it.** Every test spoke to `Room` directly, and `Room` was
right the whole time. There is now a suite that opens real sockets and speaks
the protocol, and all four of its cases fail against the old server.

---

## 4. A room could get stuck mid-song forever

**Found by:** testing the fix above with a deliberately broken video id.

The song never loaded, so that client never reported FINISH, so the round
stayed in `playing`. `READY` is ignored in that state — reasonably, since you
should not be able to re-ready mid-song — which left every player in the room
unable to do anything at all until the server was restarted.

No malice required, and that is what makes it worth fixing rather than noting:
any player can brick a room for everyone by picking a song, readying, and
closing their laptop.

Rounds now carry a watchdog — the song's own length plus ninety seconds — after
which the round ends itself and the room returns to the lobby.

---

## 5. "Video unavailable" on one machine and not the other

**Found by:** Vero and her friend, playing a YouTube song together.

> "my friend selected the song after i hit ready, but it said the video was
> unavailable after we both hit play. my side it started playing with beatmap,
> his side did not start the song"

**What the game said.** "That video cannot be played here." That sentence is
true of every possible failure and useful for none of them, and it was the only
thing the code ever produced — YouTube reports a numbered reason on the error
event and the adapter discarded it.

The reasons are genuinely different and lead to different actions:

| Code | What it means | What to do |
| --- | --- | --- |
| 2 | The video id is malformed | Add the song again from its link |
| 5 | The player would not start in this browser | Reload, or try another browser |
| 100 | Private, deleted, or blocked in that country | Try another upload |
| 101, 150 | The uploader disallows embedding | **Nothing** — use a different upload |

101 and 150 are the ones that read as a bug in the game. The video plays
perfectly on youtube.com and is blocked everywhere else, deliberately, and no
amount of reloading changes it. Someone can spend an evening on that.

**The origin was ruled out first,** since the obvious theory was that
`localhost` worked and the LAN address did not. It was checked rather than
assumed: the same video loaded fine from both `http://localhost:5181` and
`http://192.168.4.101:5181`. So the address is not the variable; the video and
the viewer are. Region and age restrictions differ per person, which fits a
video that plays for one player and not the other.

**A synchronous throw hid behind the same message.** For a malformed id the
IFrame API throws from the constructor, before any error event exists to
listen for, so that path never reached the code-handling at all. Now wrapped
with the rest.

**The half that mattered more.** One player's video failing left everyone else
waiting on someone who was never going to report a score. A failure to start is
now announced to the room and treated as finished, so the round ends. The
client sends a *code* and the server chooses the words — a system message looks
authoritative, and any client that could write its own would be able to put
official-looking text in everyone's chat.

---

## Pattern

The first two are the same shape: **a global listener that did not ask where
the event came from.**

One swallowed keystrokes meant for a text field. The other swallowed clicks
meant for a button. Neither was reachable from any unit test, because both
depend on the browser deciding who an event belongs to — focus for the
keyboard, hit-testing for the mouse.

The tests that exist are good at the engine and useless here. Finding these
needed someone typing their name into a chat box, which is a thing a person
does and a test suite never will.

The later two share a different shape: **logic that was correct alone and wrong
in company.** `Room` readied and un-readied exactly as intended; the client
called it in an order that could never converge. One player never revealed it,
because with one player every order works. Some bugs only exist between
components, and only a second machine will show them to you.
