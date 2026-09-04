import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createEmbedder } from '@lat.md/embed';
import minilm from '@lat.md/embed-minilm-fp16';
import { getLlmKey } from '../dist/src/config.js';
import {
  SearchDb,
  ensureMeta,
  ensureSectionsSchema,
} from '../dist/src/search/db.js';
import { indexSections } from '../dist/src/search/index.js';
import { searchSections } from '../dist/src/search/search.js';
const suite = JSON.parse(
  await readFile(
    new URL('../tests/cases/hybrid/judgments.json', import.meta.url),
    'utf8',
  ),
);
const root = await mkdtemp(join(tmpdir(), 'lat-search-eval-')),
  lat = join(root, 'lat.md');
await mkdir(lat);
const args = process.argv.slice(2);
const remote = args.includes('--remote');
const outputFile = args.find((arg) => arg !== '--remote');
const key = remote ? getLlmKey() : undefined;
if (remote && !key) throw new Error('--remote requires an embedding key');
const embedder = await createEmbedder(remote ? { key } : { model: minilm });
const db = new SearchDb(join(root, 'eval.db'));
try {
  await writeFile(
    join(lat, 'knowledge.md'),
    '# Knowledge\n\nReference procedures for operating a software service.\n\n' +
      suite.documents.map((d) => `## ${d.heading}\n\n${d.body}`).join('\n\n'),
  );
  await ensureMeta(db);
  await ensureSectionsSchema(db, embedder.dimensions);
  const indexStart = performance.now();
  await indexSections(lat, db, embedder);
  const indexingMs = performance.now() - indexStart;
  const records = [];
  for (const q of suite.queries) {
    const start = performance.now();
    const hits = await searchSections(db, q.query, embedder, 50);
    const ms = performance.now() - start;
    const relevant = new Set(q.relevant),
      rank = hits.findIndex((h) => relevant.has(h.heading));
    const dcg = (k) =>
      hits
        .slice(0, k)
        .reduce(
          (v, h, i) => v + (relevant.has(h.heading) ? 1 / Math.log2(i + 2) : 0),
          0,
        );
    const ideal = (k) =>
      Array.from(
        { length: Math.min(k, relevant.size) },
        (_, i) => 1 / Math.log2(i + 2),
      ).reduce((a, b) => a + b, 0);
    records.push({
      ...q,
      headings: hits.slice(0, 10).map((h) => h.heading),
      recall50: relevant.size
        ? hits.filter((h) => relevant.has(h.heading)).length / relevant.size
        : null,
      rr: !relevant.size ? null : rank < 0 ? 0 : 1 / (rank + 1),
      ndcg5: ideal(5) ? dcg(5) / ideal(5) : null,
      ndcg10: ideal(10) ? dcg(10) / ideal(10) : null,
      falsePositive: !relevant.size && hits.length > 0,
      ms,
    });
  }
  const groups = {};
  for (const split of ['development', 'held-out']) {
    const rows = records.filter((r) => r.split === split && !r.deferred);
    const mean = (key) => {
      const vals = rows.map((r) => r[key]).filter((v) => v !== null);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    groups[split] = {
      queries: rows.length,
      recall50: mean('recall50'),
      mrr: mean('rr'),
      ndcg5: mean('ndcg5'),
      ndcg10: mean('ndcg10'),
      unrelatedFalsePositives: rows.filter((r) => r.falsePositive).length,
      meanQueryMs: mean('ms'),
    };
  }
  const output = { model: embedder.name, indexingMs, groups, records };
  if (outputFile)
    await writeFile(outputFile, JSON.stringify(output, null, 2) + '\n');
  console.log(
    JSON.stringify({ model: output.model, indexingMs, groups }, null, 2),
  );
} finally {
  await db.close();
  await rm(root, { recursive: true, force: true });
}
