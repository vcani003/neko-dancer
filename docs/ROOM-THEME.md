# Play room — visual system

How the Public (and Staging) room looks, and what a theme is allowed to
change. This file is the directive for **chrome, tokens, and room art**.
`ROOM-LOOPS.md` still wins for **pages and room behaviour**. If this file
disagrees with the UI, the UI is wrong — say so and change one of them.

The source sketch is the Neko Dancer 2 UI/UX note (refresh mock + cat/bunny
backgrounds). Several of its rooms-of-the-future ideas fight things we
already paid for. Those are rewritten here, not silently kept.

Companion to `FRONTEND-DESIGN.md` (tokens, Pixi/DOM boundary) and
`ART-BRIEF.md` (figures).

---

## The rule

A theme may change colors and the background image. It may not change
layout, controls, arrow colors, or what a color means (hit, miss, error).

Cat room and bunny room are the same screen with different paint.

---

## 1. What we keep (do not redesign)

These are load-bearing. A prettier mock does not override them.

| Already true | Why it stays |
|---|---|
| **`LaneRenderer` is the stage.** No second playfield. | Paid for. Chevrons, room, TV, wander. |
| **Lanes are directions, never keys** (ADR-001). Arrow **hue and shape** stay gameplay-coded. | A theme that recolours left-pink into teal teaches the wrong note. |
| **Judgments stay semantic.** PERFECT / GREAT / GOOD / OKAY / MISS. | `OKAY` exists (ADR-005). The mock's four-word list is incomplete. |
| **YouTube stays visible** on a `.local` hostname. | The painted TV in the background art is décor. The live player punches through that hole. |
| **Public shuffles published charts.** No player queue, no Add Song in the room. | `ROOM-LOOPS.md`. Home is the shelf. Create is its own page. |
| **Cap 6.** | `ROOM-LOOPS.md`. The refresh draws ~8 and talks about 12. Concept art, not the product. |
| **One chat.** Server names the speaker. `KeyboardInput` already refuses keys in a text field. | Do not invent Room / Global / Requests. |
| **Figures wander** between rounds and dance in place during one. | `Wander.ts`. A slotted 12-person grid is a different game. |
| **No host.** Cookie identity, a label, no crown. | There is no host role yet. |
| **Create is a chart**, not a room. | Nav says Create. It does not say Create Room. |
| **Pixi owns the field; React owns chrome.** | `FRONTEND-DESIGN.md`. Do not rebuild the highway as DOM. |
| **Tokens already have roles.** `--bg`, `--panel`, `--pink`, `--green` / `--gold` / `--bad`. | Do not invent a parallel `--theme-*` vocabulary that means the same things. |

---

## 2. What we take from the refresh

The direction is right. These land.

1. **The room is a small club**, not an empty Pixi box. The two background
   plates (`public/rooms/cat-room.png`, `public/rooms/bunny-room.png`)
   *are* RoomDecor for this pass — wall, speakers, plants, neon, floor
   emblem. Do not redraw those in code.
2. **Theme is tokens on the existing names**, plus a room plate.
3. **The lane strip gets physically larger** (still a left column).
4. **ScoreHUD gets a real hierarchy** — score > combo > accuracy > grade.
5. **Chat sits under the room**, not in a tall side column. Same
   `ChatPanel`. Different slot.
6. **Sidebar is quiet**: who is here, Leave. Not a dashboard. Songs start themselves.
7. **Now Playing** is a caption on the wall screen, not a second browser.
8. **Usernames stay under the sprite**, larger, with a shadow. Player
   accent may tint the *name*, never the dance sheet.

---

## 3. Tokens

One file, consumed by CSS and by Pixi reads of computed style. Theme
swaps values. Components never write `#D84BFF`.

### 3.1 Structural (already in `src/index.css`)

| Token | Role |
|---|---|
| `--bg` | Page / room deep |
| `--panel` | Translucent chrome |
| `--panel-2` | Elevated chrome |
| `--line` | Borders |
| `--text` | Primary text |
| `--muted` | Secondary text |
| `--pink` | Brand / primary action — **becomes the room primary** |

### 3.2 Semantic — never decorative

| Token | Meaning |
|---|---|
| `--green` | Success, PERFECT-adjacent |
| `--gold` | Reward, combo milestone |
| `--bad` | Failure, MISS, danger |
| `--left` `--down` `--up` `--right` | Lane colours. Fixed across themes. |

A theme may change `--pink` (primary) and the surfaces. It may **not**
borrow `--bad` as a cute neon.

### 3.3 Room extras (new, still semantic)

```css
--room-secondary;     /* cat: violet   bunny: amber */
--room-glow;          /* primary at ~0.45 alpha */
--room-plate;         /* url of the background PNG */
```

### 3.4 Type

One sans, one mono. Theme does not swap fonts.

| Token | Size | Use |
|---|---|---|
| `--type-score` | 30–42px / 700 / tabular | Score |
| `--type-combo` | 18–22px / 700 / tabular | Combo |
| `--type-body` | 13–15px / 400 | Chat, buttons |
| `--type-name` | 12–14px / 600 | Sprite label |
| `--type-meta` | 11–13px / 500 | Artist, 2 / 6 |
| `--type-label` | 10–11px / 600 / uppercase / tracked | SCORE, HERE |

Score, combo, clock, accuracy: `tabular-nums` (already `.mono`). If the
digits jump width, the HUD is wrong.

### 3.5 Space and radius

Theme does not change these. Padding stays 4 / 8 / 12 / 16 / 24 / 32
when you swap the purple background for the teal one.

```
--space-1  4px
--space-2  8px
--space-3  12px
--space-4  16px
--space-5  24px
--space-6  32px

--radius-control  6–8px    buttons, inputs
--radius-panel    10–14px  chat, side, score shell
--radius-pill     999px    tags only
```

### 3.6 Surface, glow, focus

Chrome sits on the neon plate. Readability is these numbers, not a
darker PNG.

| Token | Role |
|---|---|
| `--surface-opacity` | Panel fill over the plate (~0.88) |
| `--surface-blur` | Small (≤10px). Enough to separate text from neon |
| `--surface-shadow` | One soft drop, not a stack of cards |
| `--room-glow` | Lane shell, video bezel, selected control |
| `--glow-strength` | 0–1. `Reduce glow` multiplies this toward 0 |
| `--focus-ring` | 2px solid, high contrast. **Not** the glow |

States, as deltas on the surface, not new colors:

| State | What changes |
|---|---|
| Hover | Surface a step brighter |
| Pressed | A step darker / inset |
| Selected | `--pink` border + `--room-glow` |
| Disabled | Contrast down, no glow |
| Focus | `--focus-ring` only |

A setting that kills glow must leave focus visible.

### 3.7 Motion

| Token | Duration | Use |
|---|---|---|
| `--motion-instant` | ~80ms | Judgment flash, keycap |
| `--motion-quick` | ~160ms | Hover, Ready |
| `--motion-considered` | ~280ms | Panels, chat drawer |

Notes, receptors, and wander are **not** these tokens. They are
`mediaTimeMs` / seeded walk. Tying scroll to a CSS duration is a bug.

`prefers-reduced-motion`: kill wander bob, plate shimmer, combo pop,
glow pulse. Do not stop the notes.

### 3.8 Sizes

Same numbers in both themes. This is how the two rooms stay one game.

| Token | Desktop |
|---|---|
| `--lane-width` | 300–360px |
| `--note-size` | 48–64px |
| `--receptor-size` | 58–72px |
| `--avatar-1-4` | 115–130px tall |
| `--avatar-5-6` | 100–115px tall |
| `--sidebar-width` | 240–300px |
| `--chat-height` | 120–170px |

Pixi reads computed style (or a shared TS map of the same values). Do
not keep a second copy in `LaneRenderer` literals.

### 3.9 Layers

```
0    plate
10   floor mark (in the PNG)
40   sprites
50   names
60   video mount
70   lanes
80   side + chat
90   judgments
100  countdown / results
```

### 3.10 Two profiles

**Cat (default).** Neon club. Deep `#120B1D`, primary `#D84BFF`,
secondary `#6E5CFF`, accent `#FF4FA3`. Plate: `/rooms/cat-room.png`.

**Bunny.** Warm lounge. Deep `#08181A`, primary `#39D9D3`, secondary
`#FFB44A`, accent `#FF7F5B`. Plate: `/rooms/bunny-room.png`.

Costume (cat/bunny sprite) and room theme are **not the same knob**.
A bunny figure can stand in the cat room. The Home figure pick is a
costume. The room plate is the place.

---

## 4. Layout

Desktop (percent of the viewport):

| Region | Width | Height |
|---|---|---|
| Lanes + score (left) | 20% | 86% |
| Score (top of left) | 20% | ~12% |
| Lanes (rest of left) | 20% | ~74% |
| Video + floor (center) | 60% | 86% |
| Video bezel | ~36% | ~28% |
| Floor | 60% | ~50% |
| List + Ready (right) | 20% | 86% |
| Chat (bottom) | 100% | 14% |

```
┌── Rhythm 20% ──┬──────── Room 60% ────────┬── Side 20% ──┐
│ ScoreHUD       │ VideoScreen / NowPlaying │ RoomHeader   │
│ NoteHighway    │                          │ PlayerList   │
│ Receptors      │ DanceFloor + wander      │ Ready        │
│ Judgment       │                          │ Leave        │
├────────────────┴──────────────────────────┴──────────────┤
│ ChatPanel 14% height                                     │
└──────────────────────────────────────────────────────────┘
```

The background image fills the center column. YouTube sits in the
painted screen, not in a second TV on top.

On a laptop, drop décor density (the plate is one image — just scale).
On a small screen: lane + HUD first, room second, chat collapsed, side
becomes a drawer.

---

## 5. Components

Each component has an owner, a job, and a ban. That is the whole
definition.

### 5.1 `PlayRoom` — React screen

**Owns:** layout slots, theme attribute (`data-room="cat" | "bunny"`),
wiring to the hub.

**Does not own:** arrows, wander, judgment flashes.

### 5.2 `RhythmPanel` — Pixi, inside `LaneRenderer`

```
RhythmPanel
├── NoteHighway     falling chevrons
├── Receptors       largest arrows, hit line
└── JudgmentDisplay word + colour near the receptor
```

| | |
|---|---|
| Width | 300–360px on desktop (today: 26% / max 320px — grow toward the top of that band) |
| Notes | 48–64px |
| Receptors | 58–72px |
| Shell | `--line` + `--room-glow`. Quiet columns. |
| Notes | `--left` `--down` `--up` `--right`. Never the room primary. |
| Judgments | Existing judgment colours, including OKAY. Theme may change glow/particles only. |

`ScoreHUD` is **not** Pixi. It is DOM, parked over the strip so it stays
crisp and so 60 Hz `setState` is not required — publish a summary on an
interval (`FRONTEND-DESIGN.md` Part 5).

### 5.3 `ScoreHUD` — React

```
ScoreHUD
├── ScoreValue      30–42px, tabular, high contrast
├── ComboValue      secondary; glow may use `--pink`
├── Accuracy        percent + thin meter
└── Grade           semantic colour
```

Hierarchy: score > combo > accuracy > grade. Theme the **shell**, not
the number colour.

### 5.4 `RoomScene` — Pixi plate + React hole

```
RoomScene
├── RoomDecor       the PNG plate (floor emblem is in the art)
├── VideoScreen     DOM mount in the painted bezel
│   └── NowPlaying  title, artist, difficulty, clock
└── DanceFloor
    └── PlayerAvatar[]   SpriteDancer + name
```

**RoomDecor.** Atmosphere only. No controls in the art. The plate already
has the cat/bunny face on the floor — do not stamp a second emblem.

**VideoScreen.** The live player is the content. Frame glow may follow
`--room-glow`. Do not shrink the video to make the speakers prettier.

**NowPlaying.** Current shuffled (or staging) chart. Not a queue. Host
line is omitted until a host exists.

### 5.5 `PlayerAvatar` — Pixi

```
PlayerAvatar
├── Sprite     dance sheet, scale by occupant count
├── Username   12–14px semibold, shadow
└── Status     no Ready word — songs start themselves
```

| Occupants | Sprite height |
|---|---|
| 1–4 | 115–130px |
| 5–6 | 100–115px |

No 9–12 row until the cap moves.

**Wander stays.** Slots are a later density tool if six cats cluster
badly, not the default. Seeded wander is how two machines watch the
same room.

Name colour may be a player accent. The sprite is not tinted — the
sheets are baked (`ART-BRIEF.md` §13b).

No crown.

### 5.6 `RoomSidebar` — React

```
RoomSidebar
├── RoomHeader     "Public · 2 / 6"
├── PlayerList     names. Floor avatars are primary
└── LeaveRoom      → Home
```

**Not in this component:** SongQueue, AddSong, Create Room, Settings,
Global chat. Those are either a different page or not in the product.

Width 240–300px. Quieter than the lane.

### 5.7 `ChatPanel` — React, same protocol

```
ChatPanel
├── MessageList
└── ChatInput
```

One tab. Height 120–170px, under the room. Player names may use accent
colours. Body stays dark in both themes. Typing is never a lane.

### 5.8 Buttons / focus

Primary = `--pink` (room primary). Hover brightens the surface. Selected
= primary border + glow. Focus = a visible outline that is not the glow.
Disabled = no glow, lower contrast. `prefers-reduced-motion` kills
decorative pulse, not scrolling notes.

---

## 6. Layers

```
0    Room plate (PNG)
10   Floor / painted emblem
30   Player shadows
40   Sprites
50   Names
60   Video mount (DOM, over the bezel hole)
70   Rhythm strip
80   Sidebar + chat
90   Judgment words
100  Overlay (countdown, results, errors)
```

Gameplay feedback sits above décor. The Pixi canvas stays
`pointer-events: none`; HUD clicks must still land
(`FRONTEND-DESIGN.md` Part 4).

---

## 7. Asset contract

```
public/rooms/
├── cat-room.png      wall, speakers, plants, neon, floor emblem
└── bunny-room.png    same composition, bunny identity
```

A later theme is: one plate + a token block that reassigns `--bg`,
`--panel`, `--pink`, `--room-secondary`, `--room-glow`. No new
components.

The plate's painted screen is a **hole target**. Measure the bezel once
and park the YouTube mount there. If the plate crops differently on a
wide window, letterbox the plate — do not stretch the cats on the floor
into ovals.

---

## 8. Theme / component matrix

| Component | Theme may change | Must stay |
|---|---|---|
| Lane shell | Border, glow | Note colour, shape, timing |
| ScoreHUD | Panel, combo glow | Number hierarchy, grade meaning |
| Video frame | Glow, trim | Video readability |
| Dance floor | The plate | Wander, depth sort by `y` |
| Avatar | Name contrast | Sheet, scale table, no tint |
| Sidebar | Active accent | Order: header, list, leave |
| Chat | Border, send, focus | One stream, server-named speaker |
| RoomDecor | The plate | Non-interactive |

---

## 9. Accessibility

Themed rooms get busy. Minimum:

- Text on panels stays high contrast.
- Colour is never the only channel (arrow glyph, judgment word).
- `prefers-reduced-motion`: no wander bob, no plate shimmer, no combo
  pop. Notes still scroll.
- A later setting may hide décor (show a flat `--bg` instead of the
  plate). Not required to ship the first plate.

---

## 10. Checklist

### Land with the plates

- [ ] `data-room` on `PlayRoom`
- [ ] Token block for cat / bunny (reassign existing names)
- [ ] Draw `cat-room.png` / `bunny-room.png` instead of the procedural
      box in `LaneRenderer.drawRoom`
- [ ] YouTube mount sits in the painted bezel
- [ ] Chat under the room
- [ ] ScoreHUD type scale
- [ ] Lane strip toward 300–360px

### Do not land

- [ ] Song queue / Add Song in Public
- [ ] 12-player slots
- [ ] Chat tabs
- [ ] Host crown
- [ ] Recoloured arrows
- [ ] A second playfield

---

## What this changes in the older docs

| Older | Here |
|---|---|
| `FRONTEND-DESIGN.md` Part 3: tokens later | Room extras now; still one vocabulary |
| Refresh spec: queue, 12 players, chat tabs, host, slots | Rewritten against `ROOM-LOOPS.md` and `Wander.ts` |
| Procedural `drawRoom` box | Replaced by a plate. Wander bounds may need a nudge so feet sit on the painted floor |
| Side chat in the prototype | Same panel, bottom slot |
