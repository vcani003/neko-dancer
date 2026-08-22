# Engineering rules

House rules for this repository. Every one of them exists because something
here broke, and each says which thing — a rule without a scar attached is
someone's habit, and habits are worth less than evidence.

Read alongside `ARCHITECTURE.md` (what the pieces are) and `SECURITY.md` (what
happens when someone is hostile).

---

## 0. The rule the rest are made of

**Everything from outside this process is data, not a promise.**

Outside means: the network, `localStorage`, a file on disk, a URL parameter,
the YouTube player, the system clock, a chart written by a build that no longer
exists. None of it is bound by your types, and all of it will eventually
disagree with them.

Check it **where it arrives**, once, and give the checked thing a name. Do not
check it again three layers down, and do not skip checking it because the
caller "obviously" already did.

The bug that made this rule the first one:

```js
// server: PICK_SONG accepted anything with an arrows array
if (!chart || typeof chart !== 'object' || !Array.isArray(chart.arrows)) break;

// server, elsewhere, on every broadcast:
song: { id: this.chart.song.id, ... }
```

`{"type":"pickSong","chart":{"arrows":[]}}` — one message, from any
unauthenticated client on the network, and the whole server exited. The type
`Chart` said `song` was there. The wire did not care.

---

## 1. TypeScript

### Types are erased. They are not a runtime check.

`Chart` is a compile-time story about a shape. At runtime there is only
`JSON.parse` output. Every boundary needs a real function that inspects real
values — `validateChart()` in `src/charts/validator.ts` is what that looks
like, and everything crossing a boundary goes through it.

A cast is an assertion you are making, not a check the compiler performs:

```ts
const chart = incoming as Chart;        // ✗ a wish
if (!validateChart(incoming).ok) return; // ✓ a fact
const chart = incoming as Chart;
```

### `npm run build` is the typecheck. `npx tsc --noEmit` is not.

The root `tsconfig.json` is a solution file. `npx tsc --noEmit` against it
reports success while the app is full of errors — it did exactly that here, and
`npm run build` then listed twelve. Only trust the build.

### `erasableSyntaxOnly` is on

So constructor parameter properties are a compile error:

```ts
constructor(readonly code: number) {}   // ✗ TS1294
constructor(code: number) { this.code = code; }  // ✓ with a declared field
```

Worth knowing before you write a class, not after.

### Optional chaining is for *absence*, not for *silence*

`?.` is right when a value is legitimately optional and the absent case is
handled:

```ts
const me = room.room?.players.find((p) => p.id === room.playerId);
if (!me) return;                        // ✓ absence has a meaning
```

It is wrong when used to make a symptom disappear:

```ts
const total = chart?.arrows?.length ?? 0;   // ✗ if a chart can be missing HERE,
                                            //   something upstream failed and
                                            //   0 arrows is a lie
```

Ask which it is. If a value should never be missing at this point, the fix is
upstream and the code here should say so loudly. If it can be missing, handle
the missing case with something better than a zero.

### Narrow to a type, don't widen to `any`

`unknown` at the boundary, narrowed by a real check, is the shape to reach for.
`useRoom` returns the room's chart as `unknown` on purpose: it came off a socket
and the consumer must validate before anything plays it.

---

## 2. Falsy values and defensive reads

**`0`, `''`, `NaN` and `false` are all falsy and all legitimate here.** A BPM of
0 is broken, a score of 0 is normal, an offset of 0 is the default, and lane
index 0 is the left arrow.

```ts
const offset = stored.offsetMs || DEFAULT;   // ✗ eats a deliberate 0
const offset = stored.offsetMs ?? DEFAULT;   // ✓ only replaces null/undefined
```

`??` unless you genuinely mean "any falsy value". `Number.isFinite` rather than
a truthiness test for numbers, because `NaN` is falsy *and* a number, and it
propagates silently through arithmetic until it reaches a renderer.

**Guard twice where the cost of being wrong is the process.** `PICK_SONG` now
checks that a chart has a song, *and* the room summary reads defensively. One
of those was supposed to be enough once already.

---

## 3. React

### The hot path never calls `setState`

Sixty frames a second through React's scheduler is a stutter. Frame data lives
in refs; a slow interval publishes a summary for display. `useRoom` stamps
arrival times in a ref for the same reason.

### Dependency arrays are about *identity*, not about *value*

`useRoom` returns a fresh object every render, so `[room]` re-runs an effect on
every render. `room.send` is a stable `useCallback`, so `[room.send]` does not.
Depend on the stable part.

### Refs for callbacks that must not restart a subscription

A handler that changes identity every render, closed over by a long-lived
subscription, restarts it constantly. Keep the handler in a ref and update it in
an effect — not during render, which is unsafe under concurrent rendering.

### StrictMode double-invokes effects in development

Every effect must be idempotent and every cleanup must actually clean up. Two
PixiJS `Application`s were once created on one canvas this way, and the
cancelled one took the WebGL context with it — the renderer drew nothing, in
development only. **Each `Application` creates its own canvas.**

### Error boundaries catch renders, and nothing else

`src/ui/ErrorBoundary.tsx` wraps the app. It does **not** catch event handlers,
`setTimeout`, `requestAnimationFrame`, or promise rejections — the game loop and
the socket handlers guard themselves.

Wrap a boundary around anything that can fail independently, so a broken
renderer does not take the menu and the chat down with it.

### A canvas over the UI eats every click

PixiJS appends its canvas after the React children, which puts it on top.
`pointer-events: none` on the canvas, explicit `z-index` on the HUD. This exact
bug shipped twice, in two projects, because the rule lived only in a CSS file.
It now lives next to a comment explaining why.

---

## 4. The server

### A throw in a message handler kills the process

`ws` dispatches the message listener from inside `Receiver._write`, with no
`try`/`catch` on that path. A throw is therefore an **uncaught exception**, not
an `error` event, and `wss.on('error')` cannot see it.

Every handler sits behind a barrier. Every async handler is `.catch()`ed at its
call site, because a rejection escaping an `async` function called from a
synchronous switch is invisible to the enclosing `try`.

### Never forward an internal error message to a client

`ENOENT: … open '/Users/vero/…'` tells every guest the host's home directory.
Log the real error; reply with something generic.

### Bound everything, and measure before choosing the bound

Message size, message rate, players, rooms, chat history, chart size, arrow
count. A limit chosen without measuring real traffic is a guess — and the 4 KB
message cap, guessed, was smaller than a real 21 KB chart, so it rejected the
happy path and crashed the server doing it. **The protection was the outage.**

### Never build a filesystem path from client input

Not even after sanitising. Case-insensitive filesystems collapse distinct keys
into one file; Unicode normalises differently across systems; reserved device
names exist; length limits are per-component. Hash the input into a
fixed-shape name, keep readability in an index, and re-check the result is
inside the intended directory using a trailing separator — a plain
`startsWith` is satisfied by a sibling directory called `<base>-anything`.

### The server chooses the words in any message that looks official

A client sends a **code**; the server picks the sentence. A client that can
write `system: true` text can post announcements that appear to come from the
server. This was hardened for one message type and left open through song
titles for weeks.

---

## 5. Testing

### Prove the test fails without the fix

Otherwise it is decoration. Revert the change, watch it go red, restore it.
Every regression test here was checked that way.

### Unit tests were correct while the game was broken

Three separate times. Focus, hit-testing and message ordering are decided by
the browser and by other processes, and no test that calls the engine directly
can see any of them. Test the **protocol** with real sockets, and play the
thing.

### Name the bug in the test

A test called `it('works')` tells the next person nothing. The ones here quote
the report that produced them.

### Fixtures must be realistic

A test chart missing `type: 'tap'` passes a server that only counts arrows and
fails the client validator — so the test proved nothing about the path it
claimed to cover.

---

## 6. Working method

**Measure rather than assert.** "The LAN address is not the problem" was stated
here on one video and was wrong for another: `localhost` played it 3/3, the IP
failed 3/3 with error 150. Run it three times, on both sides, with a control.

**Keep the reasoning in the file.** Comments say *why*, because what the code
does is already written underneath. A rule that exists only in a conversation
does not survive the conversation.

**Fix the class after the third instance.** Three single-message crashes were
patched one at a time before anyone added the barrier that makes the fourth
impossible. Repetition is the signal that a patch is in the wrong place.
