// @lat: [[search-audit#Pre-RAG comparison]]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
const [cloneArg, outArg, auditArg] = process.argv.slice(2);
const root = resolve(cloneArg),
  out = resolve(outArg),
  audit = resolve(auditArg);
const corpus = JSON.parse(readFileSync(join(audit, 'corpus.json'), 'utf8'));
for (const [path, hash] of Object.entries(corpus))
  if (
    createHash('sha256')
      .update(readFileSync(join(root, path)))
      .digest('hex') !== hash
  )
    throw Error(`Corpus mismatch: ${path}`);
const { indexSections } = await import(join(root, 'src/search/index.ts'));
const schema = await import(join(root, 'src/search/db.ts'));
const { searchSections } = await import(join(root, 'src/search/search.ts'));
const { localEmbedder } = await import(join(root, 'src/search/embedder.ts'));
const engine = await localEmbedder();
const cache = join(root, '.benchmark-cache');
if (existsSync(cache)) throw Error('Refusing nonfresh index: ' + cache);
const db = schema.openDb(join(root, 'lat.md'), cache);
await schema.ensureMeta(db);
await schema.ensureSectionsSchema(db, engine.dimensions);
let inputs = 0,
  chars = 0,
  embeddingMs = 0;
const tracked = {
  ...engine,
  embed: async (texts, progress) => {
    inputs += texts.length;
    chars += texts.reduce((a, t) => a + t.length, 0);
    const t = performance.now();
    const v = await engine.embed(texts, progress);
    embeddingMs += performance.now() - t;
    return v;
  },
};
let t = performance.now();
const stats = await indexSections(join(root, 'lat.md'), db, tracked);
const indexMs = performance.now() - t;
await schema.setStoredModel(db, `${engine.name}:${engine.dimensions}`);
const queries = JSON.parse(readFileSync(join(audit, 'queries.json'), 'utf8'));
const results = [];
for (const query of queries) {
  const [vector] = await engine.embed([query.query]);
  const cached = { ...engine, embed: async () => [vector] };
  const top5 = await searchSections(db, query.query, cached, 5);
  const top10 = await searchSections(db, query.query, cached, 10);
  const slim = (r) => r.map(({ id, score }) => ({ id, score }));
  results.push({
    ...query,
    top5: slim(top5),
    top10: slim(top10),
    queryVector: vector,
  });
}
const metadata = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  node: process.version,
  cpu: cpus()[0].model,
  model: `${engine.name}:${engine.dimensions}`,
  corpusHash: createHash('sha256')
    .update(readFileSync(join(audit, 'corpus.json')))
    .digest('hex'),
  index: { stats, indexMs, embeddingMs, inputs, characters: chars },
  defaultThreshold: 0.35,
  notes:
    'Original source and original embed source built locally; main dependency links except historical local embed and model package. Native limit5 and10 queried independently. Index timing diagnostic only; concurrent work may affect it.',
};
writeFileSync(out, JSON.stringify({ metadata, results }, null, 2), {
  flag: 'wx',
});
await schema.closeDb(db);
console.log(JSON.stringify(metadata));
