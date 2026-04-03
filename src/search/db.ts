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
  const embeddingType = `F32_BLOB(${dimensions})`;

  // Detect dimension change from the column type in the existing schema
  const schema = await db.execute(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='sections'`,
  );
  if (
    schema.rows.length > 0 &&
    !String(schema.rows[0].sql).includes(embeddingType)
  ) {
    await db.execute('DROP INDEX IF EXISTS sections_vec_idx');
    await db.execute('DROP TABLE IF EXISTS sections');
    process.stderr.write(`Embedding type changed, re-indexing...\n`);
  }

  await db.execute(
    `CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding ${embeddingType},
      updated_at INTEGER NOT NULL
    )`,
  );

  await db.execute(
    `CREATE INDEX IF NOT EXISTS sections_vec_idx
     ON sections (libsql_vector_idx(embedding))`,
  );

  await db.execute(
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );
}

export async function closeDb(db: Client): Promise<void> {
  db.close();
}
