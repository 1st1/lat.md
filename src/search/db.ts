import { createClient, type Client } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openDb(latDir: string): Client {
  const cacheDir = join(latDir, '.cache');
  mkdirSync(cacheDir, { recursive: true });

  const client = createClient({
    url: `file:${join(cacheDir, 'vectors.db')}`,
  });

  return client;
}

export async function ensureSchema(
  db: Client,
  dimensions: number,
): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );

  const metaRows = await db.execute(
    "SELECT value FROM meta WHERE key = 'embedding_dimensions'",
  );
  const stored =
    metaRows.rows.length > 0
      ? parseInt(metaRows.rows[0].value as string, 10)
      : null;
  const needsRebuild = stored !== null && stored !== dimensions;

  if (needsRebuild) {
    process.stderr.write(
      `Embedding dimensions changed (${stored} → ${dimensions}), rebuilding index...\n`,
    );
  }

  await db.execute('BEGIN');
  try {
    if (needsRebuild) {
      await db.execute('DROP INDEX IF EXISTS sections_vec_idx');
      await db.execute('DROP TABLE IF EXISTS sections');
    }

    await db.execute(
      `CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        file TEXT NOT NULL,
        heading TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding F32_BLOB(${dimensions}),
        updated_at INTEGER NOT NULL
      )`,
    );

    await db.execute(
      `CREATE INDEX IF NOT EXISTS sections_vec_idx
       ON sections (libsql_vector_idx(embedding))`,
    );

    await db.execute({
      sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('embedding_dimensions', ?)",
      args: [String(dimensions)],
    });

    await db.execute('COMMIT');
  } catch (err) {
    await db.execute('ROLLBACK');
    throw err;
  }
}

export async function closeDb(db: Client): Promise<void> {
  db.close();
}
