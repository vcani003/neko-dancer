/**
 * The disk check: close the database, open it again, the seed is still there.
 *
 * In-memory PGlite cannot say this. This is the automated form of
 * `npm run data` twice.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openFileDb } from '@neko/server';
import { Store, seedLibrary, SEED_REVISION_ID } from '@neko/server';

describe('a file-backed database outlives the process that wrote it', () => {
  it('reopens the seeded chart with the same ids', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'neko-pglite-'));

    const first = await openFileDb(directory);
    const written = await seedLibrary(new Store(first.db));
    await first.client.close();

    const second = await openFileDb(directory);
    const read = await new Store(second.db).getPlayable(SEED_REVISION_ID);
    await second.client.close();

    expect(read?.revision.id).toBe(written.revision.id);
    expect(read?.beatmap.id).toBe(written.beatmap.id);
    expect(read?.song.title).toBe('Metronome');
    expect(read?.revision.notes).toHaveLength(4);
  });
});
