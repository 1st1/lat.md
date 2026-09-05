import { connect } from '@tursodatabase/database';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
  copyFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const INDEX_VERSION = 1;
export const CREATE_PASSAGE_FTS =
  "CREATE INDEX IF NOT EXISTS chunks_fts ON lexical_chunks USING fts(body,heading,path) WITH (tokenizer='whitespace',weights='body=1.0,heading=2.0,path=0.5')";
export const MANIFEST_FILE = 'search-index.json';
export type IndexManifest = { version: number; file: string };
export function readManifest(cacheDir: string): IndexManifest | null {
  const path = join(cacheDir, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as IndexManifest;
  if (
    manifest.version !== INDEX_VERSION ||
    !/^search-[\w-]+\.db$/.test(manifest.file)
  )
    throw new Error('Search index is incompatible; run lat reindex.');
  return manifest;
}

/** Small SQL adapter; callers never depend on a libSQL connection. */
export class SearchDb {
  private connection: ReturnType<typeof connect> | undefined;
  constructor(
    readonly path: string,
    private readonly multiprocess = true,
    private readonly snapshot = false,
  ) {}
  private snapshotDir: string | undefined;
  private get() {
    if (this.connection) return this.connection;
    let path = this.path;
    if (this.snapshot) {
      this.snapshotDir = mkdtempSync(join(tmpdir(), 'lat-search-reader-'));
      path = join(this.snapshotDir, 'index.db');
      copyFileSync(this.path, path);
    }
    return (this.connection = connect(path, {
      experimental:
        this.multiprocess && process.platform !== 'win32'
          ? ['index_method', 'multiprocess_wal']
          : ['index_method'],
      timeout: 10000,
    }));
  }
  async execute(
    statement: string | { sql: string; args?: any[] },
  ): Promise<{ rows: any[] }> {
    const { sql, args = [] } =
      typeof statement === 'string' ? { sql: statement } : statement;
    const db = await this.get();
    const prepared = await db.prepare(sql);
    try {
      return { rows: await prepared.all(...args) };
    } finally {
      prepared.close();
    }
  }
  async close() {
    try {
      if (this.connection) {
        const db = await this.connection;
        await db.close();
        this.connection = undefined;
      }
    } finally {
      if (this.snapshotDir) {
        try {
          await rm(this.snapshotDir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 20,
          });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            process.platform !== 'win32' ||
            !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code ?? '')
          )
            throw error;
          // Native handles can outlive close on Windows; this is only an owned temp copy.
        }
        this.snapshotDir = undefined;
      }
    }
  }
  async checkpoint() {
    await this.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  }
}

export function openDb(
  latDir: string,
  requestedCacheDir?: string,
  readOnly = false,
): SearchDb {
  const cacheDir = requestedCacheDir ?? join(latDir, '.cache');
  mkdirSync(cacheDir, { recursive: true });
  const manifest = readManifest(cacheDir);
  return new SearchDb(
    join(cacheDir, manifest?.file ?? 'search-unpublished.db'),
    true,
    readOnly && process.platform === 'win32',
  );
}
export async function ensureMeta(db: SearchDb): Promise<void> {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
}
export async function getStoredModel(db: SearchDb): Promise<string | null> {
  const rows = await db.execute(
    "SELECT value FROM meta WHERE key='embedding_model'",
  );
  return rows.rows[0]?.value ?? null;
}
export async function setStoredModel(
  db: SearchDb,
  value: string,
): Promise<void> {
  await db.execute({
    sql: 'INSERT OR REPLACE INTO meta VALUES (?,?)',
    args: ['embedding_model', value],
  });
}
export async function ensureSectionsSchema(
  db: SearchDb,
  _dimensions: number,
): Promise<void> {
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, file TEXT NOT NULL, heading TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, parent_id TEXT, start_line INTEGER, end_line INTEGER)',
    'CREATE TABLE IF NOT EXISTS embeddings (hash TEXT PRIMARY KEY, embedding BLOB NOT NULL)',
    'CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, source_id TEXT UNIQUE NOT NULL, section_id TEXT NOT NULL, ordinal INTEGER NOT NULL, type TEXT NOT NULL, spans TEXT NOT NULL, body TEXT NOT NULL, heading TEXT NOT NULL, path TEXT NOT NULL, input_hash TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS chunks_section ON chunks(section_id)',
    'CREATE TABLE IF NOT EXISTS lexical_chunks (id INTEGER PRIMARY KEY, body TEXT NOT NULL, heading TEXT NOT NULL, path TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS identifiers (token TEXT NOT NULL, chunk_id INTEGER NOT NULL, PRIMARY KEY(token,chunk_id))',
  ])
    await db.execute(sql);
  const oldIndex = (
    await db.execute(
      "SELECT tbl_name FROM sqlite_master WHERE name='chunks_fts'",
    )
  ).rows[0];
  if (oldIndex?.tbl_name === 'chunks')
    await db.execute('DROP INDEX chunks_fts');
  await db.execute(CREATE_PASSAGE_FTS);
}
export async function dropSections(db: SearchDb): Promise<void> {
  for (const name of [
    'identifiers',
    'lexical_chunks',
    'chunks',
    'embeddings',
    'sections',
  ])
    await db.execute(`DROP TABLE IF EXISTS ${name}`);
}
export async function closeDb(db: SearchDb): Promise<void> {
  await db.close();
}
