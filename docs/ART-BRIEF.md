# Art brief — the cat, as a cut-out rig

What to generate, and why it is this and not something else.

---

## The approach: parts, assembled in code

The cat is already a **skeleton**. `src/render/CatPose.ts` describes any pose
with seven numbers:

```ts
lean      // -1 fully left … 1 fully right
crouch    //  0 standing … 1 down
leftArm   //  0 hanging … 1 overhead
rightArm
hop       // vertical bounce, in body-heights
tilt      // head tilt, radians
tail      // -1 … 1 sway
```

`blend()` and `decay()` already interpolate between poses, which is the hard
part and it is finished. The lane poses are already just numbers —
`LANE_POSES.up` is `{ leftArm: 1, rightArm: 1, … }`, not a picture.

So: **draw each body part once, in a neutral position. The code rotates them.**
There is no "up-arrow arm" to draw. There is one arm.

### Why not a frame per pose

| | Art | Blending | Accessories |
|---|---|---|---|
| Pose frames | every stance × every part | snaps between frames | redrawn in every frame |
| **Parts (this)** | **~8 images, once** | free, already built | parented to a bone, works everywhere |

Accessories decide it. A hat is one image attached to the head bone and it then
works in every pose, at every angle, forever. In a frame-based sheet it is a hat
drawn into every frame of every animation.

### Why not Spine or DragonBones

They are the professional version of exactly this, and they are the right answer
for a game with a dozen characters and a full-time animator. Here they would add
a paid tool, a runtime dependency and a learning curve to replace a skeleton
that is seven numbers and already works. Not now — and if it ever is, the parts
generated for this brief are the same parts that rig would use.

---

## What to generate

Eight images. Transparent PNG.

| # | Part | Notes |
|---|---|---|
| 1 | **Torso** | The body. Neutral, upright, facing the viewer. |
| 2 | **Head** | **Without the face.** Ears attached is fine. |
| 3 | **Face** | Eyes, nose, mouth, whiskers, on their own layer. |
| 4 | **Arm** | ONE arm, hanging straight down. Mirrored in code for the other. |
| 5 | **Leg** | ONE leg, straight. Mirrored in code. |
| 6 | **Tail — base** | The segment that meets the body. |
| 7 | **Tail — mid** | |
| 8 | **Tail — tip** | Three segments make a sway curl rather than swing like a stick. |

**The face is separate on purpose.** It lets the eyes close on a miss and blink
on idle without redrawing the head, which is most of what sells a reaction —
the current procedural cat already does this and it would be a shame to lose it.

Optional later, same rules: `ear-left`, `ear-right` if you want ears that flick
independently of the head.

---

## Rules that make them assemble correctly

These are the things that go wrong, in the order they usually go wrong.

**1. Round the joints.** A cut-out rig rotates limbs, and a flat-cut shoulder
opens a visible gap the moment the arm lifts. Draw the top of the arm and the
top of the leg as a **ball or a pill** — a rounded cap that stays covered at any
angle. This single detail is the difference between "charming paper puppet" and
"broken doll".

**2. Neutral pose, every time.** Arm hanging straight down, leg straight, tail
straight back, head level. Every rotation is applied from there, so a part drawn
already-bent bends twice.

**3. Consistent scale between parts.** Generate them in one batch, at one scale,
so the head is not twice the size of the torso. Easiest way: ask for them all in
a single image on a grid, and cut them up — I can do the cutting.

**4. Generous transparent padding.** At least 20% around each part. Rotation
sweeps outside the original bounds and a tight crop clips the limb.

**5. Pivot at the top-centre of a limb.** The rotation origin for an arm is the
shoulder, for a leg the hip, for a tail segment the end that joins the previous
one. If each part is drawn with that point at the **top edge, horizontally
centred**, I can set every anchor without measuring. If not, tell me where the
pivots are and I will use those instead — but consistency is cheaper.

**6. Face the viewer, no perspective.** The room is drawn flat with a depth
scale; a three-quarter cat will not turn to face the other way.

**7. One consistent light direction**, or none. Parts rotate; a shadow baked
into an arm ends up lit from below when the arm goes overhead.

---

## Prompt sketch

Something like this, adjusted to taste — the constraints matter more than the
wording:

> A cute chibi cat character, split into separate body parts for a cut-out
> animation rig, arranged on a grid on a transparent background: torso, head
> without face, face layer (eyes and mouth only), one arm hanging straight down,
> one leg straight, and a tail in three segments. Flat vector style, bold clean
> outlines, soft pastel palette, front-facing, no perspective, no shadows.
> Rounded ball joints at the shoulder and hip. Each part centred with padding
> around it.

Generate a few. The one to pick is the one whose **joints are roundest**, not
the one that is prettiest as a whole cat — the whole cat is assembled later and
its charm will come from the movement.

---

## What I do with them

1. Cut the grid into eight files under `apps/web/public/cat/`.
2. Replace the drawing inside `CatDancer.draw()` — sprites parented into a
   container per limb, anchored at the pivots, rotated from the same seven
   numbers that drive the shapes today.
3. `CatPose.ts` is untouched. Every existing pose, blend and decay keeps working
   because they describe angles, and angles do not care what is drawn at them.

`CatDancer` is 169 lines behind a four-method surface (`constructor`, `view`,
`draw`, `destroy`) with two call sites, so the change is contained to one file
plus asset loading.

**Colour:** the procedural cat takes `CatColours` and recolours for free. Sprites
do not. If per-player colour matters — and in a room full of identical cats it
does — either generate the parts in a **white/greyscale** form and tint them in
code, which Pixi does natively, or accept that everyone is the same cat and
distinguish players some other way. Worth deciding before the art is final.
