import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  closeDb,
  ensureMeta,
  openDb,
  setStoredModel,
} from '../../dist/src/search/db.js';

const [latDir, model] = process.argv.slice(2);
if (!latDir || !model) {
  throw new Error('usage: seed-model.mjs <lat-dir> <model>');
}

const db = openDb(latDir);
try {
  await ensureMeta(db);
  await setStoredModel(db, model);
  await db.checkpoint();
  writeFileSync(join(latDir,'.cache','search-index.json'),JSON.stringify({version:1,file:'search-unpublished.db'}));
} finally {
  await closeDb(db);
}
