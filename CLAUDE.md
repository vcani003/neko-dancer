@docs/ENGINEERING.md

# neko dancer — working notes

A recreation of **Nekodancer** (Atelier 801), which is deprecated. Faithful to
the original's design; the code and the cat art are original. Browser rhythm
game, LAN multiplayer, private repository.

- **Docs**: `docs/ARCHITECTURE.md` (what the pieces are and why) ·
  `docs/ENGINEERING.md` (house rules, loaded above) · `docs/SECURITY.md` (the
  hostile case) · `docs/PLAYTEST-FINDINGS.md` (what broke, and the pattern in it)
- **State**: engine, scoring, chart authoring, PixiJS renderer and LAN
  multiplayer all work. Chart identity and versioning done. **In progress:** the
  server-owned chart library — server as shared database, private until shared,
  owner-token deletion.
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
