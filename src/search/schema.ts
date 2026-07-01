import type { Client } from '@libsql/client';
import type { EmbeddingProvider } from './provider.js';
import { embed } from './embeddings.js';

const CONFIG_META_KEY = 'embedding_config';
const DIMENSIONS_META_KEY = 'embedding_dimensions';

async function ensureMetaTable(db: Client): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );
}

async function getMeta(db: Client, key: string): Promise<string | undefined> {
  const res = await db.execute({
    sql: 'SELECT value FROM meta WHERE key = ?',
    args: [key],
  });
  return res.rows[0]?.value as string | undefined;
}

async function setMeta(db: Client, key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}

function providerSignature(provider: EmbeddingProvider): string {
  return `${provider.name}:${provider.apiBase}:${provider.model}`;
}

export type SchemaResolution = {
  /** Vector length to use for the `sections.embedding` column. */
  dimensions: number;
  /**
   * True if the provider/model changed since the last run against this DB.
   * Callers should drop and recreate the `sections` table before calling
   * `ensureSchema()` with the new dimension count, since a fixed-size
   * `F32_BLOB` column can't hold vectors of a different size.
   */
  configChanged: boolean;
};

/**
 * Resolve the embedding vector size for `provider`, probing the API with a
 * single embed call when the provider has no statically known dimension
 * count (custom base URL or model override). The result is cached in the
 * `meta` table keyed by a `name:apiBase:model` signature so repeated
 * invocations don't re-probe, and provider/model changes are detected so
 * callers can migrate the `sections` table.
 */
export async function resolveSchema(
  db: Client,
  provider: EmbeddingProvider,
  key: string,
): Promise<SchemaResolution> {
  await ensureMetaTable(db);

  const signature = providerSignature(provider);
  const prevSignature = await getMeta(db, CONFIG_META_KEY);
  const configChanged =
    prevSignature !== undefined && prevSignature !== signature;

  let dimensions = provider.dimensions;
  if (dimensions === undefined && !configChanged) {
    const cached = await getMeta(db, DIMENSIONS_META_KEY);
    if (cached) dimensions = parseInt(cached, 10);
  }
  if (dimensions === undefined) {
    const [probe] = await embed(
      ['lat.md embedding dimension probe'],
      provider,
      key,
    );
    dimensions = probe.length;
  }

  await setMeta(db, CONFIG_META_KEY, signature);
  await setMeta(db, DIMENSIONS_META_KEY, String(dimensions));

  return { dimensions, configChanged };
}
