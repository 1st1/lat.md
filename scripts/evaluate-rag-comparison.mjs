// @lat: [[search-audit#Pre-RAG comparison]]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(
  process.argv[2] ??
    join(root, 'tests/cases/hybrid/experiments/002-pre-rag-comparison'),
);
const read = (p) =>
  JSON.parse(
    p.endsWith('.gz') ? gunzipSync(readFileSync(p)) : readFileSync(p, 'utf8'),
  );
const audit = join(root, 'tests/cases/hybrid/real-query-audit');
const previous = join(root, 'tests/cases/hybrid/experiments/001-union-rrf');
const judgments = read(join(audit, 'judgments.json'));
const queries = read(join(audit, 'queries.json'));
const indexed = new Set(
  judgments.filter((j) => j.answerExists === 'indexed').map((j) => j.id),
);
const labels = new Map();
const put = (id, section, grade) => {
  assert([0, 1, 2].includes(grade));
  const key = id + '\0' + section;
  if (labels.has(key)) assert.equal(labels.get(key), grade, key);
  labels.set(key, grade);
};
for (const j of judgments)
  for (const g of j.grades) put(j.id, g.sectionId, g.grade);
for (const file of [
  join(previous, 'known-target-labels.json'),
  join(previous, 'pool-labels.json'),
  join(dir, 'labels.json'),
])
  if (existsSync(file))
    for (const g of read(file)) put(g.queryId, g.sectionId, g.grade);
const reports = [],
  pending = new Map();
const dcg = (gs) =>
  gs
    .slice(0, 5)
    .reduce((sum, g, i) => sum + (2 ** g - 1) / Math.log2(i + 2), 0);
for (const arm of ['old', 'new', 'release']) {
  const file = join(dir, arm + '-results.json.gz');
  const data = read(file);
  assert.deepEqual(
    data.results.map((q) => [q.id, q.query]),
    queries.map((q) => [q.id, q.query]),
  );
  const perQuery = [];
  for (const q of data.results) {
    for (const r of [...q.top5, ...q.top10])
      if (!labels.has(q.id + '\0' + r.id))
        pending.set(q.id + '\0' + r.id, {
          queryId: q.id,
          query: q.query,
          sectionId: r.id,
        });
    const grades5 = q.top5.map((r) => labels.get(q.id + '\0' + r.id));
    const grades10 = q.top10.map((r) => labels.get(q.id + '\0' + r.id));
    const judged = [...grades5, ...grades10].every((g) => g !== undefined);
    const ideal = dcg(
      [...labels]
        .filter(([k]) => k.startsWith(q.id + '\0'))
        .map(([, g]) => g)
        .sort((a, b) => b - a),
    );
    const first = grades10.indexOf(2);
    perQuery.push({
      id: q.id,
      judged,
      returned5: q.top5.length,
      returned10: q.top10.length,
      direct1: judged ? Number(grades5[0] === 2) : null,
      direct5: judged ? Number(grades5.includes(2)) : null,
      direct10: judged ? Number(grades10.includes(2)) : null,
      mrr10: judged ? (first < 0 ? 0 : 1 / (first + 1)) : null,
      directPrecision5: judged
        ? grades5.filter((g) => g === 2).length / 5
        : null,
      irrelevant5: judged ? grades5.filter((g) => g === 0).length : null,
      pooledNdcg5: judged && ideal > 0 ? dcg(grades5) / ideal : null,
      limitPrefixEqual:
        JSON.stringify(q.top5.map((r) => r.id)) ===
        JSON.stringify(q.top10.slice(0, 5).map((r) => r.id)),
    });
  }
  const aggregate = (rows) =>
    Object.fromEntries([
      ['queries', rows.length],
      ['fullyJudged', rows.filter((r) => r.judged).length],
      ...[
        'direct1',
        'direct5',
        'direct10',
        'mrr10',
        'directPrecision5',
        'irrelevant5',
        'pooledNdcg5',
      ].map((k) => [
        k,
        rows.every((r) => r.judged)
          ? rows
              .filter((r) => r[k] !== null)
              .reduce((sum, r) => sum + r[k], 0) /
            (rows.filter((r) => r[k] !== null).length || 1)
          : null,
      ]),
    ]);
  reports.push({
    arm,
    inputHash: createHash('sha256').update(readFileSync(file)).digest('hex'),
    metadata:
      data.metadata ??
      Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'results')),
    all: aggregate(perQuery),
    indexed: aggregate(perQuery.filter((r) => indexed.has(r.id))),
    perQuery,
  });
}
const comparisons = [];
for (const arm of ['old', 'release']) {
  const before = reports.find((r) => r.arm === arm),
    after = reports.find((r) => r.arm === 'new');
  const deltas = before.perQuery.map((q, i) => ({
    id: q.id,
    indexed: indexed.has(q.id),
    direct1: after.perQuery[i].direct1 - q.direct1,
    direct5: after.perQuery[i].direct5 - q.direct5,
    mrr10: after.perQuery[i].mrr10 - q.mrr10,
    pooledNdcg5:
      q.pooledNdcg5 === null || after.perQuery[i].pooledNdcg5 === null
        ? null
        : after.perQuery[i].pooledNdcg5 - q.pooledNdcg5,
  }));
  comparisons.push({
    baseline: arm,
    indexedDeltas: Object.fromEntries(
      Object.keys(before.indexed)
        .filter((k) => !['queries', 'fullyJudged'].includes(k))
        .map((k) => [k, after.indexed[k] - before.indexed[k]]),
    ),
    gainedDirect5: deltas.filter((q) => q.direct5 > 0).map((q) => q.id),
    lostDirect5: deltas.filter((q) => q.direct5 < 0).map((q) => q.id),
    perQuery: deltas,
  });
}
const report = {
  labelPairs: labels.size,
  labelHash: createHash('sha256')
    .update(JSON.stringify([...labels].sort()))
    .digest('hex'),
  unjudgedPairs: pending.size,
  queries: queries.length,
  indexedQueries: indexed.size,
  reports,
  comparisons,
};
writeFileSync(
  join(dir, 'review-queue.json'),
  JSON.stringify([...pending.values()], null, 2) + '\n',
);
assert.equal(
  pending.size,
  0,
  'Review all newly returned sections before reporting metrics',
);
const out =
  process.argv[3] ??
  join(
    dir,
    `evaluation-${new Date().toISOString().replaceAll(':', '-')}.json.gz`,
  );
writeFileSync(
  out,
  out.endsWith('.gz')
    ? gzipSync(JSON.stringify(report, null, 2))
    : JSON.stringify(report, null, 2),
  { flag: 'wx' },
);
console.log(
  JSON.stringify(
    {
      out,
      labelPairs: labels.size,
      reports: reports.map(({ arm, indexed, all }) => ({ arm, indexed, all })),
      comparisons: comparisons.map(({ perQuery, ...rest }) => rest),
    },
    null,
    2,
  ),
);
