// @lat: [[search-audit#Pre-RAG comparison]]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, cpus } from 'node:os';
import assert from 'node:assert/strict';
const base = resolve(process.argv[2] ?? '/tmp/lat-012-comparison');
const arms = [];
for (const name of ['old', 'new']) {
  const root = join(base, name),
    snapshot = JSON.parse(
      readFileSync(join(base, name + '-results.json'), 'utf8'),
    );
  const schema = await import(join(root, 'src/search/db.ts'));
  const { searchSections } = await import(join(root, 'src/search/search.ts'));
  const { indexSections } = await import(join(root, 'src/search/index.ts'));
  const { localEmbedder } = await import(join(root, 'src/search/embedder.ts'));
  const engine = await localEmbedder();
  const db =
    name === 'old'
      ? schema.openDb(join(root, 'lat.md'), join(root, '.benchmark-cache'))
      : new schema.SearchDb(join(root, 'comparison.db'), false);
  arms.push({
    name,
    root,
    snapshot,
    schema,
    searchSections,
    indexSections,
    engine,
    db,
    engineOnly: [],
    warmTotal: [],
  });
}
const parity = (actual, expected) => {
  assert.deepEqual(
    actual.map((x) => x.id),
    expected.map((x) => x.id),
  );
  for (let i = 0; i < actual.length; i++)
    assert.ok(
      Math.abs((actual[i].rankScore ?? actual[i].score) - expected[i].score) <
        1e-9,
    );
};
for (const a of arms) {
  const q = a.snapshot.results[0];
  await a.searchSections(a.db, q.query, a.engine, 5);
}
for (let round = 0; round < 3; round++)
  for (let i = 0; i < 100; i++)
    for (const a of (i + round) % 2 ? [...arms].reverse() : arms) {
      const q = a.snapshot.results[i],
        embedder = {
          ...a.engine,
          embed: async () => [q.vector ?? q.queryVector],
        };
      const t = performance.now(),
        got = await a.searchSections(a.db, q.query, embedder, 5),
        ms = performance.now() - t;
      parity(got, q.top5);
      a.engineOnly.push({ round, queryId: q.id, ms });
    }
for (let i = 0; i < 100; i += 5)
  for (const a of (i / 5) % 2 ? [...arms].reverse() : arms) {
    const q = a.snapshot.results[i],
      t = performance.now(),
      got = await a.searchSections(a.db, q.query, a.engine, 5),
      ms = performance.now() - t;
    parity(got, q.top5);
    a.warmTotal.push({ queryId: q.id, ms });
  }
for (const a of arms) {
  const temporary = mkdtempSync(join(tmpdir(), 'lat-reindex-' + a.name + '-'));
  const db =
    a.name === 'old'
      ? a.schema.openDb(join(a.root, 'lat.md'), temporary)
      : new a.schema.SearchDb(join(temporary, 'fresh.db'), false);
  await a.schema.ensureMeta(db);
  await a.schema.ensureSectionsSchema(db, a.engine.dimensions);
  let inputs = 0,
    characters = 0,
    embeddingMs = 0;
  const counted = {
    ...a.engine,
    embed: async (texts, progress) => {
      inputs += texts.length;
      characters += texts.reduce((sum, t) => sum + t.length, 0);
      const t = performance.now();
      const v = await a.engine.embed(texts, progress);
      embeddingMs += performance.now() - t;
      return v;
    },
  };
  const t = performance.now(),
    stats = await a.indexSections(join(a.root, 'lat.md'), db, counted),
    ms = performance.now() - t;
  a.reindex = {
    ms,
    embeddingMs,
    inputs,
    characters,
    stats,
    note: 'Fresh database with preexisting parser cache and warmed model; schema setup excluded. One sequential sample.',
  };
  await a.schema.closeDb(db);
  rmSync(temporary, { recursive: true, force: true });
}
const summarize = (rows) => {
  const v = rows.map((x) => x.ms).sort((a, b) => a - b);
  return {
    n: v.length,
    median: v[Math.floor(v.length / 2)],
    p95: v[Math.ceil(v.length * 0.95) - 1],
    mean: v.reduce((a, b) => a + b, 0) / v.length,
  };
};
const result = {
  timestamp: new Date().toISOString(),
  cpu: cpus()[0].model,
  node: process.version,
  protocol:
    'Three rounds of100 native limit5 queries per arm with cached vectors;20 warm-total queries each using own embedder; alternating arm order; exact IDs and scores checked against quality artifacts. Reindex arms sequential. Search schema/hydration differences are original implementations.',
  arms: arms.map((a) => ({
    name: a.name,
    commit: a.snapshot.commit ?? a.snapshot.metadata.commit,
    engineOnly: { summary: summarize(a.engineOnly), samples: a.engineOnly },
    warmTotal: { summary: summarize(a.warmTotal), samples: a.warmTotal },
    reindex: a.reindex,
  })),
};
writeFileSync(
  process.argv[3] ??
    join(
      base,
      'latency-' + new Date().toISOString().replaceAll(':', '-') + '.json',
    ),
  JSON.stringify(result, null, 2),
  { flag: 'wx' },
);
for (const a of arms) await a.schema.closeDb(a.db);
console.log(
  JSON.stringify(
    result.arms.map((a) => ({
      name: a.name,
      engine: a.engineOnly.summary,
      warm: a.warmTotal.summary,
      reindex: a.reindex,
    })),
  ),
);
