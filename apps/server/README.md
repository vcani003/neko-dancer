# @neko/server

**Empty until Phase 3.** The API, auth, Postgres/Supabase access, rooms, chat,
queue, ready state and the WebSocket server move here from `server/`.

It becomes **TypeScript** in the move, which is the point: it can then import
`@neko/protocol` directly. The current server is plain `.mjs` and cannot, which
is why validation lived in two places and had to be tested against itself.

Drizzle schema and migrations live at `src/db/` inside this workspace — ADR-004
refuses them a workspace of their own.

Owned by the Data and Realtime agents.
