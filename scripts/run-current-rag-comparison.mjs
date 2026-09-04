// @lat: [[search-audit#Pre-RAG comparison]]
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [checkout, out, audit] = process.argv.slice(2);
for (const [path, hash] of Object.entries(
  JSON.parse(readFileSync(audit + '/corpus.json')),
))
  assert.equal(
    createHash('sha256')
      .update(readFileSync(checkout + '/' + path))
      .digest('hex'),
    hash,
    path,
  );
const source = (p) =>
  import(pathToFileURL(checkout + '/src/search/' + p + '.ts'));
const { SearchDb, ensureMeta, ensureSectionsSchema, setStoredModel } =
  await source('db');
const { indexSections } = await source('index');
const { localEmbedder } = await source('embedder');
const { searchSections } = await source('search');
const startModel = performance.now();
const engine = await localEmbedder();
const modelLoadMs = performance.now() - startModel;
let embeddingInputs = 0,
  embeddingCalls = 0;
const counted = {
  ...engine,
  embed: async (texts, ...args) => {
    embeddingInputs += texts.length;
    embeddingCalls++;
    return engine.embed(texts, ...args);
  },
};
if (existsSync(checkout + '/comparison.db'))
  throw new Error('Refusing nonfresh index');
const db = new SearchDb(checkout + '/comparison.db', false);
try {
  const start = performance.now();
  await ensureMeta(db);
  await ensureSectionsSchema(db, engine.dimensions);
  const stats = await indexSections(checkout + '/lat.md', db, counted);
  await setStoredModel(db, `${engine.name}:${engine.dimensions}`);
  await db.checkpoint();
  const indexingMs = performance.now() - start;
  const counts = {};
  for (const t of ['sections', 'chunks', 'embeddings'])
    counts[t] = (await db.execute('SELECT COUNT(*) AS n FROM ' + t)).rows[0].n;
  const queries = JSON.parse(readFileSync(audit + '/queries.json'));
  const results = [];
  for (const q of queries) {
    const [vector] = await engine.embed([q.query]);
    const fixed = { ...engine, embed: async () => [vector] };
    const row = { id: q.id, query: q.query, vector };
    for (const limit of [5, 10])
      row['top' + limit] = (
        await searchSections(db, q.query, fixed, limit)
      ).map((r) => ({
        id: r.id,
        score: r.rankScore,
        lexicalRank: r.lexicalRank,
        semanticRank: r.semanticRank,
      }));
    results.push(row);
  }
  writeFileSync(
    out,
    JSON.stringify(
      {
        implementation: 'current',
        commit: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: checkout,
          encoding: 'utf8',
        }).trim(),
        model: {
          name: engine.name,
          dimensions: engine.dimensions,
          maxInputTokens: engine.maxInputTokens,
          tokenizerFingerprint: engine.tokenizerFingerprint,
        },
        modelLoadMs,
        indexingMs,
        embeddingInputs,
        embeddingCalls,
        stats,
        counts,
        indexBytes: statSync(db.path).size,
        results,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
} finally {
  await db.close();
}
