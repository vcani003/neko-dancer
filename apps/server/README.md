# @neko/server

Persistence and cookie identity. Phase 3.

Drizzle talks to Postgres. Tests use **PGlite** — the same dialect, in
process, no network, no leftover state. Production later is a hosted
Postgres (Supabase or otherwise); that wiring is a deploy concern, not
the Phase 3 gate, and this package does not require a live project to
typecheck or to test.

HTTP, rooms, chat, queue and the play loop are not here yet. They move
in from `server/` in later phases and call `Store`.

```
src/db/        schema + in-memory client
src/store.ts   Song → Beatmap → ChartRevision, plus users, library, scores
src/identity/  httpOnly cookie; the id is the person, the name is a label
src/seed.ts    one published click-track chart for MVP 1
```

`localStorage` is not authoritative anywhere in this package. A gate test
reads the source to keep it that way.

To see rows survive a process dying — not a test file, a file on disk:

```
npm run data         # writes apps/server/.data/pglite and prints the seed
npm run data         # same ids. that is persistence.
npm run data:reset   # delete the file and start over
```

`npm run serve` is the old prototype. It does not open this database.

Owned by the Data agent. Realtime arrives in Phase 7.
