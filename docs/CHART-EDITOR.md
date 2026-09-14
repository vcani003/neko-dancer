# Chart editor

How a draft becomes notes you can stand behind. Phase 8 in
`STATUS.md`. Companion to `ROOM-LOOPS.md` (the create → Staging loop)
and `FRONTEND-DESIGN.md` (Storybook, fixtures, `mediaTimeMs`).

This is the **Staging workshop**. Public keeps the current room plate
— painted TV, wander, chat. Play still happens on `LaneRenderer`.
The timeline is creator chrome, not a second playfield.

---

## Staging layout

Unlocked Staging is a CapCut-shaped page: preview on top, tools and
timeline below.

```
┌────────────────────┬─────────────────────────────────────┐
│                    │                                     │
│  lanes  L D U R    │         YouTube song window         │
│  (LaneRenderer)    │                                     │
├────────────────────┴─────────────────────────────────────┤
│  asset bin — drag phrases, taps, holds, sections         │
│  [  ?  ]  hotkeys                                        │
├──────────────────────────────────────────────────────────┤
│  chart timeline   playhead = mediaTimeMs                 │
│  ─────────────────────────────────────────────────────── │
└──────────────────────────────────────────────────────────┘
```

| Slot | Job |
|---|---|
| **Lanes** | The zoomed-in vertical slice. Feel, receptors, the picture you play. |
| **YouTube** | The song, pausable. Staging already allows video clicks. |
| **Asset bin** | CapCut tray. Drag a tap, a 1/2/4-beat hold, a phrase, a skip section onto the timeline. Other actions (snap, lock, regen) live here too. |
| **Timeline** | The whole chart, time → right. Zoom, scrub, drag, trim. |
| **Hotkey help** | One `?`. Bindings are not a manual in the bin. |

`LaneRenderer` is not a different chart. It is the close-up of the
same notes the timeline owns. Zooming the timeline changes how many
milliseconds a pixel is. The lane slice’s “zoom” is scroll speed.
They share `mediaTimeMs` (ADR-007). They must not diverge.

When the chart is **locked**, Ready is shown and the bin + timeline
quiet down (read-only playhead, or collapsed — decide when building).
The real run still uses these same lanes, not a second stage.

---

## Timeline tracks — one row, not four

**Default: one row.** A note is a clip. Lane is the arrow glyph and
the lane colour, not a track you sit on. Same-timestamp combos are
**one clip with several glyphs**, stacked at that playhead — not
four independent clips piled until you cannot click the one
underneath.

Four stacked lanes would tell the truth, and they would also spend
the height we just gave to YouTube and the bin on three empty
tracks. Most of a generated phrase chart is one note at a time.
The four-lane picture already exists above, around *now*. The
timeline’s job is *when* and *how long*.

| | One row (default) | Four stacked lanes |
|---|---|---|
| **Reads as** | “Things happen here.” CapCut. | “This is a piano roll of directions.” |
| **Chords** | One stacked clip at that timestamp | Four dots in a vertical line |
| **Height** | Fits under the video | Four tracks + ruler; lanes above already did this |
| **Change lane** | Key, or a handle on the clip | Drag to another track |
| **Overlapping holds** | Weak — two durations share a row | Strong — each hold has its own track |
| **Jacks** (same lane twice) | Easy to miss | Obvious |

A chord is a group, not a pile. Click once to select the group,
click again (or hold a lane key) to pick one direction out of it.

**Split-lanes is a view toggle**, not the default. Turn it on when
you are stretching overlapping holds or hunting a jack. Same notes.
Same playhead. The asset bin does not change.

The prototype’s `SectionEditor` bar is the ancestor of a *section*
track (play / skip / intensity), not of four note tracks. If
sections come back they sit **above** the note row as a second
thin strip — song shape, not arrows.

---

## Assets on the chart

Things you drag from the bin, or place with keys. Not a second
schema — these are `Note`s and authoring marks.

| Asset | Stored as | Stretch / cut means |
|---|---|---|
| Tap | `Note` `type: 'tap'` | A point. Move or delete. Does not stretch. |
| Hold | `Note` `type: 'hold'` + `durationMs` | Clip length. Trim like a video clip. Convert a tap first. |
| Chord | Several notes at one `timeMs` | One stacked clip. Up to four lanes. |
| Phrase | A run of notes (from the bin or `gridNotes`) | Drop a clip; keep or regenerate the notes. |
| Section | Optional later — play / skip / intensity | “This passage is empty.” |
| Bookmark | Authoring-only | Jump points. `B`. |
| Chart end | Last media time the draft covers | Right edge of the timeline. |

---

## Moves

- **Zoom** the timeline (wheel / pinch / `+` `−`). Snap stays in
  beats.
- **Scrub** the playhead; lanes and YouTube follow `mediaTimeMs`.
- **Drag** from the bin, or slide a clip along time.
- **Extend / cut** a hold. A tap does not stretch.
- **Keys** still work: `A` add, arrows place, delete removes,
  space play/pause (Shift+space stays BPM tap on Create).
- **Overwrite, not ripple**, unless a phrase-clip layer needs it.
  Notes do not shove neighbours.

---

## What does not change

- Notes stay absolute media times (ADR-003). Dragging a clip
  rewrites `timeMs` / `durationMs`. No second clock.
- Published revisions stay immutable. Editing writes a new draft
  revision (`POST /api/beatmaps/:id/revisions`).
- `LaneRenderer` stays the stage you play on.
- Generate-and-test, Back, and Regen stay the cheap loop. The
  editor is for when a new seed is not enough.
- Public does not get the bin or the timeline.

---

## Storybook

`FRONTEND-DESIGN.md` already lets a story drive the field from a
number. Chart editing uses that: a fixture revision, a playhead,
the same chart as a horizontal timeline **and** as the lane slice.
Build those fixtures when the editor is real enough to have
unreachable states (dense chords, overlapping holds, a failed
`validateChartRevision`). Not a gallery for its own sake.
