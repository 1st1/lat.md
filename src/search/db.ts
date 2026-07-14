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

/**
 * Ensure the schema matches the active embedder. The embedding model+dimensions
 * are recorded in `meta`; if they differ from a previous run (e.g. switching
 * between local MiniLM at 384-dim and hosted OpenAI at 1536-dim), the cached
 * vectors are dropped and rebuilt, since the vector column width is fixed.
 */
export async function ensureSchema(
  db: Client,
  modelName: string,
  dimensions: number,
): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );

  const current = `${modelName}:${dimensions}`;
  const prev = await db.execute(
    "SELECT value FROM meta WHERE key = 'embedding_model'",
  );
  const prevModel = prev.rows[0]?.value as string | undefined;
  if (prevModel && prevModel !== current) {
    // Model/dimension change → the F32_BLOB width no longer matches. Drop and
    // rebuild; indexSections will re-embed every section on the next pass.
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
    sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('embedding_model', ?)",
    args: [current],
  });
}

export async function closeDb(db: Client): Promise<void> {
  db.close();
}
