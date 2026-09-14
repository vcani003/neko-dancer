/**
 * Load `charts/export.json` into the on-disk database.
 *
 *     npm run data:import
 *     npm run data
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFileDb } from '../src/db/client.ts';
import { importV1Dump } from '../src/import/v1.ts';
import { seedLibrary } from '../src/seed.ts';
import { Store } from '../src/store.ts';

const DATA_DIR = resolve(fileURLToPath(new URL('../.data/pglite', import.meta.url)));
const EXPORT = resolve(fileURLToPath(new URL('../../../charts/export.json', import.meta.url)));

const { db, client } = await openFileDb(DATA_DIR);
const store = new Store(db);
await seedLibrary(store);

const dump = JSON.parse(readFileSync(EXPORT, 'utf8'));
const result = await importV1Dump(store, dump);
const published = await store.listPublished();

console.log(
  result.imported === 0
    ? `already loaded (${result.skipped} unchanged)`
    : `imported ${result.imported}, skipped ${result.skipped}`,
);
for (const row of published) {
  console.log(`  ${row.noteCount} notes  ${row.title}  ${row.artist}`);
}

await client.close();
