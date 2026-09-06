import { createClient } from '@libsql/client';

// Exit before migration tests rename the file: libSQL can retain native handles.
const [path, model] = process.argv.slice(2);
const db = createClient({ url: `file:${path}` });
try {
  if (model) {
    await db.execute('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
    await db.execute({
      sql: 'INSERT INTO meta VALUES (?,?)',
      args: ['embedding_model', model],
    });
  } else {
    await db.execute(
      'CREATE TABLE sections(id TEXT PRIMARY KEY, embedding F32_BLOB(1536))',
    );
    await db.execute({
      sql: 'INSERT INTO sections VALUES (?,vector(?))',
      args: ['stale#Old', JSON.stringify(new Array(1536).fill(0.1))],
    });
  }
  await db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
} finally {
  db.close();
}
