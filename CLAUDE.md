@docs/ENGINEERING.md

# neko dancer — working notes

A recreation of **Nekodancer** (Atelier 801), which is deprecated. Faithful to
the original's design; the code and the cat art are original. Browser rhythm
game, LAN multiplayer, private repository.

- **Docs, in reading order**: `docs/SYSTEM-DESIGN.md` is **the contract** —
  the what and why, and the authority. `docs/IMPLEMENTATION-PLAN.md` is the who,
  where and how we prove it. Then `docs/ENGINEERING.md` (house rules, loaded
  above), `docs/SECURITY.md` (the hostile case), `docs/PLAYTEST-FINDINGS.md`
  (what broke and the pattern in it). `docs/FRONTEND-DESIGN.md` covers the
  design system, state ownership and the Storybook plan.
  `docs/ARCHITECTURE.md` describes the CURRENT build and is being superseded by
  the system design.
- **State**: **architecture-changing feature work is frozen** (system design
  §31.1). The prototype works end to end — engine, scoring, chart authoring,
  PixiJS renderer, LAN multiplayer, lobby video preflight — and is now being
  rebuilt against the domain model `Song → Beatmap → ChartRevision`, with
  Postgres as the source of truth and real accounts instead of browser tokens.
- **Three open decisions** blocking Phase 0, in `IMPLEMENTATION-PLAN.md` Part 1:
  lane identity (direction vs key), round start (duration vs timestamp), and
  whether a chart offset is ever added to a note time.
- **Stack**: React 19 · TypeScript 6 · Vite 8 · PixiJS 8 · `ws` · Vitest 3.
  The server is plain `.mjs` on purpose — no build step, nothing to go stale,
  at the cost of not being able to import the TypeScript validator.
- **Run it**: `npm run build && npm run serve`. The server serves `dist/`, so a
  source change is invisible until it is rebuilt.

## Gotchas

- **`npx tsc --noEmit` does not check this project.** The root tsconfig is a
  solution file and reports success while the app is broken. Use
  `npm run build`.
- **`erasableSyntaxOnly` is on**, so constructor parameter properties
  (`constructor(readonly x: number)`) are a compile error. Declare the field.
- **Share the `.local` hostname, never the IP.** YouTube refuses to embed
  restriction-bearing videos on a bare IP origin — error 150, measured 3/3
  against 3/3 success from `localhost` and from `<machine>.local`. The startup
  banner prints the right one.
- **`localStorage` is per origin.** `localhost:5181` and
  `<machine>.local:5181` have separate stores, which is also how to simulate
  two players in one browser.
- **Each PixiJS `Application` needs its own canvas.** Under StrictMode two get
  created and the cancelled one takes the WebGL context with it — the renderer
  then draws nothing, in development only.
- **`pointer-events: none` on the Pixi canvas.** It is appended after the React
  children, so without it it covers the UI and eats every click.
- **A throw inside a `ws` message handler kills the process.** `ws` dispatches
  from `Receiver._write` with no try/catch, so it is an uncaught exception, not
  an `error` event. The handler sits behind a barrier; keep it that way.
- **The server serves `dist/`, not `src/`.** Restart after `npm run build`.

## Working agreements

- **Plan before implementing** anything non-trivial, and ask when the request is
  ambiguous rather than guessing at scope.
- **Prove a test fails without the fix.** Revert, watch it go red, restore.
- **Measure rather than assert.** Claims about behaviour get three runs and a
  control. "The address is not the problem" was asserted here and was wrong.
- **Regressions get a test**, and the test quotes the report that produced it.
- **Ask before deploying or pushing.** This repository has no remote by design.
- **Explain the jargon in the thing itself** — a control someone cannot name is
  a control they tune by superstition.
