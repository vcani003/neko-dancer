/**
 * Open the on-disk database, seed if empty, print what is there, exit.
 *
 * Run it twice. Same ids the second time means the rows survived the
 * process dying — that is persistence, and it is the thing the in-memory
 * tests cannot show you. `npm run serve` is the old prototype and does
 * not open this file; killing it proves nothing.
 *
 *     npm run data
 *     npm run data          # same ids
 *     npm run data:reset    # wipe the file and start over
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFileDb } from '../src/db/client.ts';
import { Store } from '../src/store.ts';
import { seedLibrary, SEED_REVISION_ID } from '../src/seed.ts';

const DATA_DIR = resolve(fileURLToPath(new URL('../.data/pglite', import.meta.url)));

async function main(): Promise<void> {
  mkdirSync(dirname(DATA_DIR), { recursive: true });
  const { db, client } = await openFileDb(DATA_DIR);
  const store = new Store(db);
  const before = await store.getPlayable(SEED_REVISION_ID);
  await seedLibrary(store);
  const published = await store.listPublished();

  console.log(before ? 'reopened existing database' : 'wrote a new database');
  console.log(`file: ${DATA_DIR}`);
  console.log('');
  console.log(`library  ${published.length} published chart(s)`);
  for (const row of published) {
    console.log(`  ${row.noteCount} notes  ${row.title}`);
  }

  await client.close();
}

await main();
