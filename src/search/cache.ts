import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  SearchDb,
  readManifest,
  INDEX_VERSION,
  MANIFEST_FILE,
  ensureMeta,
  getStoredModel,
} from './db.js';

/** Cross-process writer lock; a crashed owner's lock can be reclaimed. */
async function lock(cacheDir: string): Promise<() => Promise<void>> {
  const path = join(cacheDir, 'search-write.lock');
  const deadline = Date.now() + 120000;
  while (true) {
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      return async () => {
        await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const { pid } = JSON.parse(await readFile(path, 'utf8'));
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
              await rm(path, { force: true });
              continue;
            }
          }
        }
      } catch {
        /* Owner may still be writing the lock. */
      }
      if (Date.now() > deadline)
        throw new Error('Search index writer is busy; retry shortly.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function archiveLegacy(cacheDir: string): Promise<string | null> {
  const migration = join(cacheDir, 'search-migration.json');
  if (existsSync(migration)) {
    const { model, archive } = JSON.parse(await readFile(migration, 'utf8'));
    const old = join(cacheDir, 'vectors.db');
    if (existsSync(old) && !existsSync(archive)) await rename(old, archive);
    for (const suffix of ['-wal', '-shm', '-journal'])
      if (existsSync(old + suffix) && !existsSync(archive + suffix))
        await rename(old + suffix, archive + suffix);
    return model;
  }
  const old = join(cacheDir, 'vectors.db');
  if (!existsSync(old)) return null;
  const { createClient } = await import('@libsql/client');
  const legacy = createClient({ url: `file:${old}` });
  let model: string | null = null;
  try {
    const tables = await legacy.execute(
      "SELECT name FROM sqlite_master WHERE name='meta'",
    );
    if (tables.rows.length)
      model =
        ((
          await legacy.execute(
            "SELECT value FROM meta WHERE key='embedding_model'",
          )
        ).rows[0]?.value as string) ?? null;
    await legacy.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    legacy.close();
  }
  let archive = old + '.old-12',
    suffix = 0;
  while (existsSync(archive)) archive = old + `.old-12.${++suffix}`;
  await writeFile(migration, JSON.stringify({ model, archive }));
  await rename(old, archive);
  for (const sidecar of ['-wal', '-shm', '-journal'])
    if (existsSync(old + sidecar))
      await rename(old + sidecar, archive + sidecar);
  return model;
}

/** Stage a complete generation; failed work cannot replace a usable index. */
export async function writeIndex<T>(
  latDir: string,
  cacheDir: string | undefined,
  rebuild: boolean,
  work: (db: SearchDb, storedModel: string | null) => Promise<T>,
): Promise<T> {
  const dir = cacheDir ?? join(latDir, '.cache');
  await mkdir(dir, { recursive: true });
  const release = await lock(dir);
  const name = `search-${randomUUID()}.db`,
    path = join(dir, name);
  let db: SearchDb | undefined;
  try {
    let manifest;
    try {
      manifest = readManifest(dir);
    } catch (error) {
      if (!rebuild) throw error;
      manifest = null;
    }
    let model: string | null = null;
    if (manifest) {
      const active = new SearchDb(join(dir, manifest.file));
      try {
        await ensureMeta(active);
        model = await getStoredModel(active);
        await active.checkpoint();
      } finally {
        await active.close();
      }
      if (!rebuild) await copyFile(join(dir, manifest.file), path);
    } else model = await archiveLegacy(dir);
    // Staging has one writer and no readers. Multiprocess WAL can stall large
    // FTS builds; enable it only when opening published generations.
    db = new SearchDb(path, false);
    await ensureMeta(db);
    const changesBefore = (await db.execute('SELECT total_changes() AS n'))
      .rows[0].n;
    const result = await work(db, model);
    const unchanged =
      manifest &&
      !rebuild &&
      (await db.execute('SELECT total_changes() AS n')).rows[0].n ===
        changesBefore;
    await db.checkpoint();
    await db.close();
    db = undefined;
    if (unchanged) {
      for (const suffix of ['', '-wal', '-shm'])
        await rm(path + suffix, { force: true });
      return result;
    }
    const temp = join(dir, `${MANIFEST_FILE}.${randomUUID()}.tmp`);
    await writeFile(
      temp,
      JSON.stringify({ version: INDEX_VERSION, file: name }),
    );
    await rename(temp, join(dir, MANIFEST_FILE));
    return result;
  } catch (error) {
    await db?.close();
    for (const suffix of ['', '-wal', '-shm'])
      await rm(path + suffix, { force: true });
    throw error;
  } finally {
    await release();
  }
}
