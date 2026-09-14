/**
 * Open a database. Tests get PGlite — Postgres in-process, no network, no
 * leftover state. Production later is the same Drizzle schema against a
 * hosted Postgres; this file is not that wiring.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema.ts';
import { SCHEMA_SQL } from './sql.ts';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDb {
  db: Database;
  client: PGlite;
}

export async function openMemoryDb(): Promise<OpenDb> {
  const client = new PGlite();
  await client.exec(SCHEMA_SQL);
  const db = drizzle({ client, schema });
  return { db, client };
}

/**
 * Postgres on disk. Close the client when you are done — the next process
 * that opens this directory should see the same rows. That is the check
 * "did it persist?", and it is why this exists: in-memory PGlite cannot
 * answer it, and the prototype `npm run serve` never opens this file.
 */
export async function openFileDb(directory: string): Promise<OpenDb> {
  const client = new PGlite(directory);
  await client.exec(SCHEMA_SQL);
  const db = drizzle({ client, schema });
  return { db, client };
}
