// @lat: [[search-audit#Real query corpus#Fast replay of agent judgments]]
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { tmpdir, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { localEmbedder } from '../src/search/embedder.ts';
import { openDb, SearchDb } from '../src/search/db.ts';
import {
  collectSearchCandidates,
  rankSearchCandidates,
  searchSections,
  literalFtsQuery,
} from '../src/search/search.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const audit = join(root, 'tests/cases/hybrid/real-query-audit');
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: {
      type: 'string',
      default: 'tests/cases/hybrid/experiments/001-union-rrf',
    },
    cache: { type: 'string' },
    out: { type: 'string' },
  },
});
const experiment = resolve(root, values.dir);
const config = JSON.parse(
  readFileSync(join(experiment, 'config.json'), 'utf8'),
);
const queries = JSON.parse(readFileSync(join(audit, 'queries.json'), 'utf8'));
const judgments = JSON.parse(
  readFileSync(join(audit, 'judgments.json'), 'utf8'),
);
const historical = JSON.parse(
  readFileSync(join(audit, 'results.json'), 'utf8'),
);
const digest = (input) => createHash('sha256').update(input).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const save = (name, value) =>
  writeFileSync(join(experiment, name), JSON.stringify(value, null, 2) + '\n');
const rankingSources = [
  'src/search/search.ts',
  'src/search/lexical.ts',
  'src/search/chunks.ts',
  'src/search/index.ts',
  'src/search/db.ts',
  'src/search/embedder.ts',
  'scripts/experiment-search.mjs',
  'pnpm-lock.yaml',
];
const provenance = () => ({
  sourceDirty:
    execFileSync('git', ['status', '--porcelain', '--', ...rankingSources], {
      cwd: root,
      encoding: 'utf8',
    }).trim().length > 0,
  queriesHash: digest(readFileSync(join(audit, 'queries.json'))),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceHashes: Object.fromEntries(
    rankingSources.map((p) => [p, digest(readFileSync(join(root, p)))]),
  ),
  configHash: digest(readFileSync(join(experiment, 'config.json'))),
  corpusHash: digest(readFileSync(join(audit, 'corpus.json'))),
});
const snapshotPath = join(experiment, 'scores.json.gz');

async function openFrozenIndex() {
  if (values.cache)
    return {
      db: openDb(join(root, 'lat.md'), resolve(values.cache)),
      cleanup() {},
    };
  const manifestPath = join(experiment, 'index-snapshot.json');
  if (!existsSync(manifestPath))
    throw new Error(
      'Exact index snapshot required. Capture with --cache pointing to the frozen audit cache; rebuilding FTS can change scores.',
    );
  const manifest = json(manifestPath);
  const compressed = readFileSync(join(experiment, manifest.file));
  assert.equal(digest(compressed), manifest.sha256, 'Index archive changed');
  assert.equal(
    digest(readFileSync(snapshotPath)),
    manifest.scoreSnapshotHash,
    'Score snapshot changed',
  );
  assert.equal(provenance().corpusHash, manifest.corpusHash, 'Corpus changed');
  const dir = mkdtempSync(join(tmpdir(), 'lat-ranking-experiment-'));
  try {
    const path = join(dir, 'index.db');
    writeFileSync(path, gunzipSync(compressed));
    return {
      db: new SearchDb(path, false),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function capture() {
  if (existsSync(snapshotPath))
    throw new Error(
      'Capture already exists; use a new experiment directory instead of overwriting it.',
    );
  const { db, cleanup } = await openFrozenIndex();
  try {
    const meta = (await db.execute('SELECT * FROM meta')).rows;
    assert.deepEqual(
      new Map(meta.map((r) => [r.key, r.value])),
      new Map(
        json(join(audit, 'index-meta.json')).map((r) => [r.key, r.value]),
      ),
      'Frozen index metadata differs',
    );
    const chunks = (await db.execute('SELECT id,section_id FROM chunks')).rows;
    const engine = await localEmbedder();
    const records = [];
    for (const q of queries) {
      const [vector] = await engine.embed([q.query]);
      const fts = literalFtsQuery(q.query);
      const lexical = fts
        ? (
            await db.execute({
              sql: 'SELECT id,fts_score(body,heading,path,?) AS score FROM lexical_chunks ORDER BY score DESC LIMIT ?',
              args: [fts, chunks.length],
            })
          ).rows
        : [];
      const semantic = (
        await db.execute({
          sql: 'SELECT c.id,1-vector_distance_cos(e.embedding,vector32(?)) AS score FROM chunks c JOIN embeddings e ON c.input_hash=e.hash ORDER BY score DESC LIMIT ?',
          args: [JSON.stringify(vector), chunks.length],
        })
      ).rows;
      const exact = (
        await db.execute({
          sql: 'SELECT chunk_id FROM identifiers WHERE token=? LIMIT ?',
          args: [q.query.toLowerCase(), 10 * chunks.length],
        })
      ).rows;
      records.push({
        id: q.id,
        query: q.query,
        tokens: engine.countTokens(q.query),
        vector,
        fts,
        lexical,
        semantic,
        exact,
      });
      if (records.length % 20 === 0)
        console.log(`Captured ${records.length}/${queries.length}`);
    }
    const snapshot = {
      version: 1,
      provenance: provenance(),
      indexMeta: meta,
      chunks,
      engine: {
        name: engine.name,
        dimensions: engine.dimensions,
        maxInputTokens: engine.maxInputTokens,
        tokenizerFingerprint: engine.tokenizerFingerprint,
      },
      queries: records,
    };
    await db.checkpoint();
    const archive = gzipSync(readFileSync(db.path));
    writeFileSync(join(experiment, 'index.db.gz'), archive, { flag: 'wx' });
    writeFileSync(snapshotPath, gzipSync(JSON.stringify(snapshot)), {
      flag: 'wx',
    });
    writeFileSync(
      join(experiment, 'index-snapshot.json'),
      JSON.stringify(
        {
          file: 'index.db.gz',
          sha256: digest(archive),
          scoreSnapshotHash: digest(readFileSync(snapshotPath)),
          corpusHash: provenance().corpusHash,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    console.log(`Saved reusable scores to ${snapshotPath}`);
  } finally {
    await db.close();
    cleanup();
  }
}

function cachedInputs(snapshot, q) {
  const owner = new Map(snapshot.chunks.map((c) => [c.id, c.section_id]));
  const db = {
    async execute(statement) {
      const { sql, args = [] } =
        typeof statement === 'string' ? { sql: statement } : statement;
      if (sql === 'SELECT id,section_id FROM chunks')
        return { rows: snapshot.chunks };
      if (sql.startsWith('SELECT chunk_id FROM identifiers'))
        return { rows: q.exact.slice(0, args[1]) };
      if (sql.includes('fts_score(')) {
        assert.equal(
          args[0],
          q.fts,
          'Query lexical policy changed; recapture scores',
        );
        return { rows: q.lexical.slice(0, args[1]) };
      }
      if (sql.includes('vector_distance_cos(')) {
        assert.equal(args[0], JSON.stringify(q.vector));
        if (sql.includes('WHERE c.section_id IN')) {
          const ids = new Set(args.slice(1));
          return { rows: q.semantic.filter((r) => ids.has(owner.get(r.id))) };
        }
        return { rows: q.semantic.slice(0, args[1]) };
      }
      throw new Error(`Uncaptured SQL: ${sql}`);
    },
  };
  const engine = {
    ...snapshot.engine,
    countTokens(text) {
      assert.equal(text, q.query);
      return q.tokens;
    },
    async embed(texts) {
      assert.deepEqual(texts, [q.query]);
      return [q.vector];
    },
  };
  return { db, engine };
}
function splitQueries() {
  const topics = [...new Set(queries.map((q) => q.topic))],
    split = {};
  for (const topic of topics) {
    const group = queries
      .filter((q) => q.topic === topic)
      .sort((a, b) =>
        digest(config.splitSeed + a.id).localeCompare(
          digest(config.splitSeed + b.id),
        ),
      );
    group.forEach(
      (q, i) =>
        (split[q.id] =
          i < config.developmentPerTopic ? 'development' : 'validation'),
    );
  }
  return split;
}
function labels() {
  const map = new Map();
  const put = (queryId, sectionId, grade) => {
    assert([0, 1, 2].includes(grade), 'Invalid relevance grade');
    const key = queryId + '\0' + sectionId;
    if (map.has(key))
      assert.equal(map.get(key), grade, `Conflicting label ${key}`);
    map.set(key, grade);
  };
  for (const j of judgments)
    for (const g of j.grades) put(j.id, g.sectionId, g.grade);
  for (const name of ['known-target-labels.json', 'pool-labels.json'])
    if (existsSync(join(experiment, name)))
      for (const g of json(join(experiment, name)))
        put(g.queryId, g.sectionId, g.grade);
  return map;
}
function evaluate(rows, labelMap) {
  const perQuery = [];
  for (const r of rows) {
    const grades = r.results.map((x) => labelMap.get(r.id + '\0' + x.id));
    const known = [...labelMap]
      .filter(([key]) => key.startsWith(r.id + '\0'))
      .map(([, g]) => g)
      .sort((a, b) => b - a);
    const dcg = (gs) =>
      gs
        .slice(0, 5)
        .reduce((n, g, i) => n + (2 ** g - 1) / Math.log2(i + 2), 0);
    const ideal = dcg(known),
      judged5 = grades.slice(0, 5).every((g) => g !== undefined),
      judged10 = grades.every((g) => g !== undefined);
    perQuery.push({
      id: r.id,
      judged5,
      judged10,
      unjudged5: grades.slice(0, 5).filter((g) => g === undefined).length,
      ndcg5: judged5 && ideal > 0 ? dcg(grades) / ideal : null,
      direct5: judged5 ? Number(grades.slice(0, 5).some((g) => g === 2)) : null,
      mrr10: judged10
        ? grades.findIndex((g) => g === 2) < 0
          ? 0
          : 1 / (grades.findIndex((g) => g === 2) + 1)
        : null,
      irrelevant5: judged5
        ? grades.slice(0, 5).filter((g) => g === 0).length
        : null,
    });
  }
  const mean = (key) => {
    const vals = perQuery.map((q) => q[key]).filter((v) => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    queries: rows.length,
    fullyJudged5: perQuery.filter((q) => q.judged5).length,
    fullyJudged10: perQuery.filter((q) => q.judged10).length,
    pooledNdcg5: perQuery.every((q) => q.judged5) ? mean('ndcg5') : null,
    directAnswerRate5: perQuery.every((q) => q.judged5)
      ? mean('direct5')
      : null,
    mrr10: perQuery.every((q) => q.judged10) ? mean('mrr10') : null,
    meanIrrelevant5: perQuery.every((q) => q.judged5)
      ? mean('irrelevant5')
      : null,
    perQuery,
  };
}
async function run() {
  const start = performance.now();
  const snapshot = JSON.parse(gunzipSync(readFileSync(snapshotPath)));
  assert.equal(
    snapshot.provenance.corpusHash,
    provenance().corpusHash,
    'Corpus changed',
  );
  assert.deepEqual(
    snapshot.queries.map((q) => [q.id, q.query]),
    queries.map((q) => [q.id, q.query]),
    'Captured query set changed',
  );
  const split = splitQueries(),
    labelMap = labels(),
    pending = new Map(),
    runs = [];
  const indexed = new Set(
    judgments.filter((j) => j.answerExists === 'indexed').map((j) => j.id),
  );
  const candidates = new Map();
  for (const q of snapshot.queries) {
    const { db, engine } = cachedInputs(snapshot, q);
    for (const mode of ['retrieved', 'union'])
      candidates.set(
        q.id + mode,
        await collectSearchCandidates(db, q.query, engine, 10, 0.2, mode),
      );
  }
  for (const policy of config.policies) {
    const rows = snapshot.queries.map((q) => ({
      id: q.id,
      results: rankSearchCandidates(
        candidates.get(q.id + policy.candidateScoring),
        policy,
        10,
      ).map((r) => ({
        id: r.id,
        rankScore: r.rankScore,
        lexicalRank: r.l?.rank,
        semanticRank: r.v?.rank,
      })),
    }));
    if (policy.id === config.baseline)
      for (const r of rows) {
        const original = historical.find((x) => x.id === r.id).matches;
        assert.deepEqual(
          r.results.map((x) => x.id),
          original.map((x) => x.id),
          `Baseline ordering changed: ${r.id}`,
        );
        for (let i = 0; i < original.length; i++)
          assert(
            Math.abs(r.results[i].rankScore - original[i].rankScore) < 1e-12,
            `Baseline score changed: ${r.id}`,
          );
      }
    for (const r of rows)
      for (const [i, m] of r.results.entries())
        if (!labelMap.has(r.id + '\0' + m.id)) {
          const key = r.id + '\0' + m.id;
          const entry = pending.get(key) ?? {
            queryId: r.id,
            query: queries.find((q) => q.id === r.id).query,
            sectionId: m.id,
            variants: [],
          };
          entry.variants.push({ id: policy.id, rank: i + 1 });
          pending.set(key, entry);
        }
    const groups = {
      all: rows,
      indexed: rows.filter((r) => indexed.has(r.id)),
      development: rows.filter(
        (r) => indexed.has(r.id) && split[r.id] === 'development',
      ),
      validation: rows.filter(
        (r) => indexed.has(r.id) && split[r.id] === 'validation',
      ),
    };
    const knownTargetRanks = json(
      join(experiment, 'known-target-labels.json'),
    ).map((target) => {
      const ranking = rankSearchCandidates(
        candidates.get(target.queryId + policy.candidateScoring),
        policy,
        Number.MAX_SAFE_INTEGER,
      );
      const index = ranking.findIndex((r) => r.id === target.sectionId);
      return {
        queryId: target.queryId,
        sectionId: target.sectionId,
        grade: target.grade,
        rank: index < 0 ? null : index + 1,
      };
    });
    runs.push({
      knownTargetRanks,
      policy,
      metrics: Object.fromEntries(
        Object.entries(groups).map(([k, rs]) => [k, evaluate(rs, labelMap)]),
      ),
      rankings: rows,
    });
  }
  const baseline = runs.find((r) => r.policy.id === config.baseline);
  const selectable =
    pending.size === 0 &&
    runs.every((r) => r.metrics.development.pooledNdcg5 !== null);
  const winner = selectable
    ? [...runs].sort((a, b) => {
        for (const metric of ['pooledNdcg5', 'directAnswerRate5', 'mrr10']) {
          const delta =
            b.metrics.development[metric] - a.metrics.development[metric];
          if (delta) return delta;
        }
        return 0; // Preserve the predeclared policy order for complete ties.
      })[0]
    : null;
  const validationPassed =
    winner !== null &&
    ['pooledNdcg5', 'directAnswerRate5'].every(
      (key) =>
        winner.metrics.validation[key] !== null &&
        winner.metrics.validation[key] >= baseline.metrics.validation[key],
    );
  const decision = {
    developmentWinner: winner?.policy.id ?? null,
    validationPassed,
    promotion: validationPassed
      ? 'requires explicit review including latency and fresh-query confirmation'
      : 'retain baseline',
  };
  const report = {
    decision,
    provenance: provenance(),
    scoreSnapshotHash: digest(readFileSync(snapshotPath)),
    labelHash: digest(JSON.stringify([...labelMap].sort())),
    split,
    replayMs: performance.now() - start,
    unjudgedPairs: pending.size,
    runs,
  };
  const runId = `${new Date().toISOString().replaceAll(':', '-')}-${report.labelHash.slice(0, 8)}`;
  const out = values.out
    ? resolve(values.out)
    : join(experiment, 'runs', `${runId}.json.gz`);
  mkdirSync(dirname(out), { recursive: true });
  const serialized = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(out, out.endsWith('.gz') ? gzipSync(serialized) : serialized, {
    flag: 'wx',
  });
  save('latest.json', {
    file: relative(experiment, out),
    provenance: report.provenance,
    unjudgedPairs: pending.size,
  });
  console.log(`Immutable run: ${out}`);
  save('review-queue.json', [...pending.values()]);
  console.log(
    `Baseline parity: 100/100 queries. ${config.policies.length} variants in ${(report.replayMs / 1000).toFixed(2)}s; ${pending.size} unjudged pairs.`,
  );
  for (const r of runs)
    console.log(
      JSON.stringify({
        id: r.policy.id,
        dev: r.metrics.development.pooledNdcg5,
        validation: r.metrics.validation.pooledNdcg5,
        judged: r.metrics.all.fullyJudged5,
        direct5: r.metrics.indexed.directAnswerRate5,
      }),
    );
}

async function benchmark() {
  const snapshot = JSON.parse(gunzipSync(readFileSync(snapshotPath)));
  const { db, cleanup } = await openFrozenIndex();
  const policies = ['retrieved', 'union'].map((candidateScoring) => ({
    ...config.policies.find((p) => p.id === config.baseline),
    id: candidateScoring,
    candidateScoring,
  }));
  const samples = [];
  const runOne = async (q, policy, engine, phase, round) => {
    const t = performance.now();
    const results = await searchSections(db, q.query, engine, 10, 0.2, policy);
    const elapsedMs = performance.now() - t;
    const cached = cachedInputs(snapshot, q);
    const expected = rankSearchCandidates(
      await collectSearchCandidates(
        cached.db,
        q.query,
        cached.engine,
        10,
        0.2,
        policy.candidateScoring,
      ),
      policy,
      10,
    );
    assert.deepEqual(
      results.map((r) => [r.id, r.rankScore]),
      expected.map((r) => [r.id, r.rankScore]),
      `${phase} live/cached parity ${q.id} ${policy.id}`,
    );
    samples.push({ id: q.id, policy: policy.id, phase, round, elapsedMs });
  };
  try {
    for (let round = 0; round < 3; round++)
      for (const [i, q] of snapshot.queries.entries()) {
        const ordered = (i + round) % 2 ? policies : [...policies].reverse();
        for (const p of ordered)
          await runOne(
            q,
            p,
            cachedInputs(snapshot, q).engine,
            'engine-only',
            round,
          );
      }
    console.log('Live engine-only parity passed for 600 searches.');
    const engine = await localEmbedder();
    await engine.embed(['warmup']);
    const selected = snapshot.queries.filter((q, i) => i % 5 === 0);
    for (const [i, q] of selected.entries())
      for (const p of i % 2 ? policies : [...policies].reverse())
        await runOne(q, p, engine, 'warm-total', 0);
    const quantile = (xs, q) => {
      const a = [...xs].sort((a, b) => a - b);
      return a[Math.ceil(q * a.length) - 1];
    };
    const metrics = [];
    for (const phase of ['engine-only', 'warm-total'])
      for (const policy of policies) {
        const xs = samples
          .filter((s) => s.phase === phase && s.policy === policy.id)
          .map((s) => s.elapsedMs);
        metrics.push({
          phase,
          policy: policy.id,
          count: xs.length,
          medianMs: quantile(xs, 0.5),
          p95Ms: quantile(xs, 0.95),
        });
      }
    const out = values.out
      ? resolve(values.out)
      : join(
          experiment,
          `latency-${new Date().toISOString().replaceAll(':', '-')}.json`,
        );
    writeFileSync(
      out,
      JSON.stringify(
        { provenance: provenance(), cpu: cpus()[0].model, metrics, samples },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    console.log(JSON.stringify({ out, metrics }, null, 2));
  } finally {
    await db.close();
    cleanup();
  }
}

if (positionals[0] === 'capture') await capture();
else if (positionals[0] === 'run') await run();
else if (positionals[0] === 'benchmark') await benchmark();
else
  throw new Error(
    'Usage: pnpm experiment:search capture|run|benchmark [--dir directory] [--cache frozen-index-cache] [--out replay.json]',
  );
