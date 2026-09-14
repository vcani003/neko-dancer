/**
 * The Phase 4 gate, as a command. Seeds an in-memory store, plays the
 * tutorial perfectly against the fake adapter, prints the result.
 *
 *     npm run play
 */
import { COUNTDOWN_MS } from '@neko/protocol';
import { openMemoryDb, seedLibrary, Store, SEED_REVISION_ID } from '@neko/server';
import { FakePlaybackAdapter } from '../src/playback/FakePlaybackAdapter.ts';
import { PlaySession } from '../src/play/PlaySession.ts';

const { db } = await openMemoryDb();
const store = new Store(db);
await seedLibrary(store);
const fake = new FakePlaybackAdapter();
const session = new PlaySession({ catalog: store, adapter: fake });

const listed = await session.list();
console.log(`library  ${listed.length} published`);
await session.choose(SEED_REVISION_ID);
session.beginCountdown(0);
session.tick(COUNTDOWN_MS);

for (const [timeMs, lane] of [
  [1000, 'left'],
  [2000, 'down'],
  [3000, 'up'],
  [4000, 'right'],
] as const) {
  fake.setTime(timeMs);
  const hit = session.press(lane);
  console.log(`  ${timeMs}ms  ${lane}  ${hit?.judgment ?? '—'}`);
}

const result = session.result();
console.log('');
console.log(`score ${result?.score}  combo ${result?.combo}  accuracy ${result?.accuracy}`);
console.log(result?.completed ? 'completed' : 'failed');
