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
} finally {
  await closeDb(db);
}
