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

## Pattern

Both bugs are the same shape: **a global listener that did not ask where the
event came from.**

One swallowed keystrokes meant for a text field. The other swallowed clicks
meant for a button. Neither was reachable from any unit test, because both
depend on the browser deciding who an event belongs to — focus for the
keyboard, hit-testing for the mouse.

The tests that exist are good at the engine and useless here. Finding these
needed someone typing their name into a chat box, which is a thing a person
does and a test suite never will.
