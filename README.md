# neko dancer

A recreation of [Nekodancer](https://atelier801.fandom.com/wiki/Nekodancer)
(Atelier 801, 2014): a browser rhythm game of falling arrows, played against
other people in rooms.

> **Keep this repository private.** It recreates someone else's game, under
> their name. See [`docs/SECURITY.md`](docs/SECURITY.md) §1.

## Running it

```bash
npm install
npm run dev                 # play alone, hot reload
```

To play with other people on the same network:

```bash
npm run build
npm run serve               # prints the address to share
```

The server binds every interface so others can reach it. On a shared or public
network that means everyone can — `HOST=127.0.0.1 npm run serve` restricts it
to this machine.

## How it plays

Arrows fall toward a receptor line. Hit the matching arrow key — or WASD — as
each arrow arrives. Five judgments: **Perfect · Nice · Okay · Oops · Miss**.
Missing drains health; run out and the song ends.

## Where it came from

The engine is ported from [hop//beat](../hop-beat), a webcam rhythm game whose
camera input was deprecated — the haptics, latency and readability problems are
written up in its spec §25. None of the engine was ever camera-specific:

- `GameClock` — an authoritative playback clock with minimum-drift bias
  correction, proven against a real click track
- the playback adapters, chart schema and validator
- the testing approach: pure engine, fake clocks, no hardware

Everything above the input layer transferred unchanged, which was the argument
for the pivot. Keys also fix every problem that stopped the camera version:
real haptics, no inference latency, and thirty years of proven visual language.

## Layout

```
src/
  engine/       clock, five-tier judgment, scoring with health, the game loop
  charts/       schema, validator, hand-authored charts
  playback/     click track and local audio; YouTube later
  input/        keyboard to lanes
  render/       the PixiJS falling-arrow field
  net/          the room connection
server/         static files, rooms, chat — no networking in the rules
tests/          pure logic; no browser, no audio, no hardware
docs/
  SECURITY.md            what is fixed, what is known, what accounts will need
  PLAYTEST-FINDINGS.md   bugs found by playing, and why tests missed them
```

## Charts

A song needs a chart. There are two ways to get one, and which applies depends
on whether the audio can be read at all.

**YouTube: it cannot.** The developer policies forbid extracting or isolating
audio, and the embed offers no samples regardless. So a chart for a YouTube
song is **tapped in** while it plays — `ChartRecorder` fits a tempo grid to the
taps by least squares and snaps the notes onto it.

**Local audio: it can**, and analysis is worth building for files we hold.

Either way the chart is **cached** (`ChartStore`, keyed by playback source), so
a song is charted once and every play after reuses it — the original calls this
"Processing". What is cached is note times, lanes and tempo. Never audio.

## Status

Stage 0, plus YouTube playback and tap-authoring. Playable solo against a click
track; rooms, chat and a live scoreboard work on a local network. Not yet
built: the cat, the tap-authoring UI, accounts, progression. See
[`../hop-beat/docs/NEKODANCER-PLAN.md`](../hop-beat/docs/NEKODANCER-PLAN.md).
