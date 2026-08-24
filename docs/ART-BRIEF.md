# Avatar animation — the cat

The art direction, the rig, and how the animation systems compose.

This began as a brief for one dancing cat. It is now the foundation of the
avatar system: dance, walking, idling and emoting. The rig did not change to
absorb that, which is the point.

---

## The one idea

> **Animation complexity grows in code and in small reusable part variants —
> never by multiplying full-body artwork across pose × direction × animation ×
> accessory.**

Everything below is downstream of that sentence. When a decision is unclear, the
question is "does this add a drawing, or a number?"

---

## 1. Visual direction

**Reference:** LINE Play, Kingdom Hearts Union χ — social-game avatars.

| | |
|---|---|
| **Outlines** | Extremely light, or none. Shape separation comes from **colour**, not contour. |
| **Shading** | Soft, low-contrast cel. Subtle internal shading only. |
| **Proportions** | Large head, tiny body. Chibi. |
| **Construction** | Simple and modular — it must read as assembled parts. |
| **Legibility** | Clean and readable **at small size**. The cat is often a fifth of the room. |
| **Facing** | Front-facing. |

**Not:** a plush mascot. Not a sticker illustration. Not heavily rendered.

**No strongly directional baked shadows.** Parts rotate. A shadow painted onto
an arm as though lit from above ends up lit from below the moment the arm goes
overhead. Internal shading is fine where it stays plausible through the whole
rotation range.

> The earlier direction said *"bold clean outlines"*. That is superseded — it
> pulls toward sticker illustration and away from a social avatar.

---

## 2. The four layers

An avatar's appearance in any frame is the composition of four independent
systems. They **compose**; none replaces another.

```
world transform          where the cat is in the room, and how big
  + locomotion           walking: legs, bob, arm swing, facing
  + gesture (CatPose)    dance, WASD, emote body language
  + expression           face state and texture swaps
```

### What already exists

| Layer | State |
|---|---|
| **World transform** | ✅ `Wander.ts` — `Walker`, `step()`, `ROOM_BOUNDS`, `depthScale()`. `LaneRenderer` already sorts by `y` for depth. |
| **Locomotion** | ❌ `step()` moves the cat but exposes no `direction`, `speed` or `walkPhase`. |
| **Gesture** | ✅ `CatPose.ts` — seven values, `blend()`, `decay()`, `poseAt()`. |
| **Expression** | ❌ The face is drawn inside `CatDancer` rather than being a layer. |

So this is an extension of a working system, not a rewrite.

### The composition rule that will bite if we do not decide it now

Walking wants the arms (swing). A lane press wants the arms (raise). Both are
live at once the moment someone hits an arrow while crossing the room.

**Gesture wins, and locomotion yields smoothly.** Locomotion contributes an
*offset*; gesture contributes a *target*; the locomotion contribution is scaled
down by how strongly a gesture is active:

```
arm = locomotionSwing × (1 − gestureStrength) + gesturePose
```

The same holds for the tail: both layers push it, gesture dominates while it is
decaying, and locomotion's sway returns as the gesture fades. Without this rule
the two systems fight and the arms stutter.

This also implies `poseAt()` grows a sibling that returns a **partial offset**
rather than a complete pose, so layers can sum. `CatPose`'s own behaviour is
untouched.

---

## 3. The part library

A **part library**, not a sprite sheet. Transparent PNG.

| Part | Notes |
|---|---|
| `torso` | Neutral, upright, front-facing |
| `head` | **Without the face.** Ears attached for now |
| `face` | Eyes, nose, mouth, whiskers — its own layer |
| `arm` | ONE arm, hanging straight down. Mirrored in code |
| `paw_relaxed` | The hanging, idle hand |
| `paw_open` | The reaching hand, for a raised arm |
| `paw_fist` | Curled. Optional at first, expected soon — a miss reads better with it |
| `leg` | ONE leg, straight. Mirrored in code |
| `tail_base` · `tail_mid` · `tail_tip` | Three segments sway as a curl rather than swinging like a stick |

**One arm and one leg texture, mirrored** — but see §5: the *runtime* holds two
independent leg nodes even though they share one texture.

Add a variant **only when rotation or face state visibly fails**, never in
advance. That rule is what keeps the library from becoming a sheet.

---

## 4. Rules that make parts assemble correctly

In the order they usually go wrong.

1. **Round the joints.** A flat-cut shoulder opens a gap the instant the arm
   lifts. The top of the arm and the top of the leg are a **ball or pill** that
   stays covered at any angle. This one detail separates "charming paper puppet"
   from "broken doll".
2. **Neutral pose, always.** Arm hanging, leg straight, tail straight back, head
   level. A part drawn already-bent bends twice.
3. **Consistent scale.** Generate in one batch on a grid so the head is not
   twice the torso. I will cut the grid.
4. **Generous transparent padding** — 20% or more. Rotation sweeps outside the
   original bounds and a tight crop clips the limb.
5. **Pivot at top-centre.** Shoulder for an arm, hip for a leg, the joining end
   for a tail segment. Drawn that way, I set every anchor without measuring.
6. **Front-facing, no perspective.** The room is flat with a depth scale.
7. **No directional baked shadows** — see §1.

---

## 5. Locomotion

Walking is not a `CatPose`. Forcing a walk cycle into seven gesture values would
make both worse.

**Movement is click-to-move at a single steady pace.** Click a point, the cat
walks there. No WASD, no arrows, no run, no acceleration — WASD and the arrow
keys belong entirely to gameplay lanes, so movement input and lane input never
compete.

That simplifies this layer considerably:

```ts
interface Locomotion {
  /** Derived from the movement vector, not from input. */
  direction: MoveDirection;
  /** Effectively binary at one pace: walking, or not. */
  moving: boolean;
  /** 0 … 1, loops. Advances with DISTANCE, not time. */
  walkPhase: number;
}

type MoveDirection =
  | 'up' | 'down' | 'left' | 'right'
  | 'upLeft' | 'upRight' | 'downLeft' | 'downRight';
```

`direction` is read off the vector toward the target and only used to choose
mirroring and lean — nothing dispatches on it yet (§6).

### `Wander.step()` is already most of this

It walks toward a `target`, clamps to `ROOM_BOUNDS`, and already tracks
`facing` from the sign of `dx`. Click-to-move is **supplying the target from a
click instead of from `wanderTarget()`**. Wandering becomes what happens when
nobody has clicked.

**One thing must change.** It approaches exponentially —
`t = 1 − exp(−rate · dt)` — which eases out and makes the cat *creep* the last
stretch. At a steady pace that reads as sliding, and it fights the whole point of
foot contact. Constant speed toward the target, stop on arrival.

`walkPhase` advances with **distance travelled**, not with time. Tied to time, a
cat that is barely moving still takes full-speed steps and skates.

### Independent legs

One texture, **two nodes**: `leftLegNode` and `rightLegNode`, each rotating and
translating independently. The walk is four keyframes with interpolated
in-betweens:

```
LEFT CONTACT    left leg forward · right back · opposite arm swing · body lower
PASS            legs near centre · body higher
RIGHT CONTACT   right leg forward · left back · opposite arm swing · body lower
PASS            legs near centre · body higher
```

**Goals, and they are all restraint:** tiny stride · clear alternating foot
contact · slight body bob · restrained opposite-arm motion · the large head
stays visually stable · the tail follows with a delay.

**Do not make it bouncy.** A chibi walk that bounces reads as hopping, and this
avatar spends most of its time walking.

**Foot contact is the thing that sells it.** A planted foot makes the cat belong
to the floor; two sliding feet make it hover. If only one detail survives review,
it is this one.

---

## 6. Direction, without eight art sets

**Do not build eight directional families.** First implementation uses the
existing front-facing avatar for every direction, communicating heading through
lean, mirroring, walk phase and small transform differences.

At one steady pace with click-to-move, this matters less than it would with
free-running input: the cat crosses a small room slowly, and the eye has time to
read position rather than needing the silhouette to announce heading.

Then look at it. If **up** genuinely fails because the cat should be showing its
back, add `head_back` and `torso_back` at that point. If side movement needs a
different silhouette, add it then.

Same rule as everywhere: **a texture variant when the geometry visibly fails,
not before.**

---

## 7. Idle

Two or three variations, all **procedural on the existing rig** — no new
character drawings.

| | |
|---|---|
| `idle-neutral` | Very subtle breathing: body rises and settles |
| `idle-sway` | Tiny asymmetric weight shift, slight arm movement, tail follow-through |
| `idle-paw` | Rare small paw adjustment, or similar personality beat |

**Principles:** a relaxed 2–3 second cycle · head mostly stable · body movement
very small · arms barely move · tail trails the body · occasional blinking ·
**never a repeated wave** · avoid perfect symmetry.

Selection carries some randomness, so a room of cats is not one cat looping in
unison. Seed it per player, the way `Wander` already seeds wandering.

---

## 8. Emotes

The separated face becomes an expression system. **No full-body sprite per
emote.**

An emote composes: **eye state · mouth state · head tilt · body lean/crouch ·
arm gesture · paw swap · tail position.**

```
happy       eyes happy    · mouth smile  · body tiny lift  · tail raised
surprised   eyes wide     · mouth small O · body recoil    · arms slightly up
sad         eyes sad      · mouth frown  · head tilts down · tail droops
```

Starter set: `happy` `surprised` `sad` `angry` `love` `awkward` `sleepy`
`groove`.

Eyes and mouth are separate small textures, so eight emotes cost roughly eight
eye states and six mouth states — not eight cats. Ears stay attached to the head
for the first conversion; split them out only if independent ear reactions turn
out to matter.

---

## 9. Animation feel

- **Stable oversized head.** The body does the moving; the head reads as
  weighted. This is most of what makes a chibi avatar look right.
- **Small ranges** for locomotion and idle. **Dance may exaggerate freely** —
  that is the one place large motion belongs.
- **Ease, don't march.** Linear interpolation reads as robotic.
- **Secondary motion:** body leads → head follows slightly → tail follows later.
- **Asymmetry** in idle and emotion. Perfect mirroring looks mechanical.
- **Foot contact** — §5.
- **Short transitions.** Idle→walk, walk→idle and gesture changes blend rather
  than snap. `blend()` and `decay()` already do this for gestures.

---

## 10. The room

The avatar is a small RPG/social-game character that walks around a room.

**World movement is independent of animation.** `cat.x` / `cat.y` say where it
is; the walk cycle loops while velocity is non-zero. Neither drives the other.

**Navigation uses the feet, not the silhouette.** The footprint for collision and
pathing is a small ellipse at the floor — a giant head that overlaps a lamp is
correct and should not block movement.

**Depth sorting is by `y`.** Already implemented: `LaneRenderer` sorts drawn cats
by `y`, and `depthScale()` shrinks with distance. Furniture must eventually join
the same sort, or a cat will walk in front of a chair it is standing behind.

---

## 11. Terminology

"Idle set", "WASD set", "walking set", "emote set" mean **an animation
definition over the shared part library** — not a new collection of full-body
sprites. A set may carry a few texture variants; the body art is shared.

```
idle    shared parts + neutral face
W       shared parts + open paw when the arms rise
walk    shared parts + independent left/right leg transforms
sad     shared parts + sad face + tail down
```

---

## 12. Phases

Do not design all future art before Phase 1 is validated.

**Build the systems procedurally first. Swap in art last.** This is a change
from the original ordering, and it is the better one — see §13.

| | | Needs art? |
|---|---|---|
| **1** | Click-to-move: target from a click, constant speed, `facing` | no |
| **2** | Independent leg nodes and one basic walk cycle | no |
| **3** | One neutral idle that looks correct | no |
| **4** | Extra idle variations, blinking | no |
| **5** | Expression as a real layer — face out of `CatDancer` | no |
| **6** | First emotes | no |
| **7** | **Swap procedural drawing for segmented sprites** | **yes** |
| **8** | Paw texture swaps, and only then directional variants if needed | yes |

Phases 1–6 need no art at all. The procedural cat can express every one of them
— less prettily, and that is fine, because what is being tuned is **timing and
feel**, which survive the swap.

---

## 13. When art is actually needed — not yet

**The sprite does not need to exist for any of this to be built.** The rig is
angles; the art is what gets drawn at them. Everything in §5–§9 — click-to-move,
the walk cycle, idle variations, blinking, emotes — is arithmetic over the same
seven values plus a locomotion layer, and the procedural cat renders all of it
today.

Doing the systems first is not merely acceptable, it is **better**:

- **Iteration is instant.** Tuning a walk cycle means changing a number and
  reloading. With art in place, adjusting proportions means regenerating a part
  library and re-cutting it.
- **Per-player colour already works.** `CatColours` recolours procedurally for
  free, which is the open question in §13b — deferring the swap defers needing
  to answer it.
- **The systems are what is risky.** Whether a chibi walk reads as walking, and
  whether a room of cats is legible at that size, are questions art cannot
  answer. They are timing and scale questions.
- **Tuning survives the swap.** Angles, phase offsets and easing carry over
  unchanged, because `CatPose` describes intent rather than pixels.

The one real risk is **proportion drift**: poses tuned against a procedural cat
with different proportions than the final art will need retouching. That is
bounded — §1 fixes large head and tiny body, and matching the procedural cat's
proportions to the brief now costs nothing.

So: **the brief's job right now is to stop us building something that makes the
swap expensive.** Full-body pose frames, pose logic baked into the drawing code,
or a face welded to the head would each do that. Avoiding those costs nothing
and is the whole reason to have written this before the art exists.

Make the art when the movement already looks right and you want it to look
good.

## 13b. Open — decide before the art is final

**Per-player colour.** The procedural cat takes `CatColours` and recolours for
free; sprites do not. A room of identical cats is a real legibility problem, and
it is already visible in multiplayer today. Two options:

- Draw the parts **white or greyscale** and tint per player in code — Pixi does
  this natively, and it preserves the free-recolour property.
- Accept one shared look and distinguish players another way (name labels exist
  already, but they are small).

The greyscale route costs nothing extra at generation time and keeps the option
open, so it is the one to take unless the style depends on baked colour.

---

## Prompt sketch

Constraints matter more than wording. Generate several; pick the one whose
**joints are roundest**, not the prettiest whole cat — the charm comes from the
movement, which does not exist yet.

> A cute chibi cat avatar in a soft social-game style, split into separate body
> parts for a cut-out animation rig, arranged on a grid on a transparent
> background: torso, head without face, face layer (eyes and mouth only), one arm
> hanging straight down, one leg straight, three tail segments, and three paw
> shapes (relaxed, open, curled). Large head, tiny body. Extremely light or no
> outlines — shapes separated by colour rather than contour. Soft low-contrast
> cel shading, no strong directional shadows. Front-facing, no perspective.
> Rounded ball joints at shoulder and hip. Each part centred with padding.
