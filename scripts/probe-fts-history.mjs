// @lat: [[search-audit#FTS history-dependent scoring]]
// Isolated engine reproducer: no Lat indexing or embedding calls in minimal mode.
import { connect } from '@tursodatabase/database';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const query = 'apple OR banana';
const create =
  "CREATE INDEX fts ON docs USING fts(body) WITH (tokenizer='whitespace')";
const modes = [
  'noop',
  'insert-delete',
  'delete-reinsert',
  'update-same',
  'replace-same',
  'insert-live',
  'delete-live',
  'repeat-update',
  'rollback',
];
const report = {
  engine: JSON.parse(
    readFileSync(
      new URL(
        '../node_modules/@tursodatabase/database/package.json',
        import.meta.url,
      ),
    ),
  ).version,
  minimal: [],
};
const dir = mkdtempSync(join(tmpdir(), 'lat-fts-history-'));
try {
  for (const multiprocess of [false, true])
    for (const mode of modes) {
      const path = join(dir, `${mode}-${multiprocess}.db`);
      const options = {
        experimental: [
          'index_method',
          ...(multiprocess ? ['multiprocess_wal'] : []),
        ],
      };
      let db = await connect(path, options);
      const exec = async (sql, ...args) => {
        const statement = await db.prepare(sql);
        try {
          return await statement.all(...args);
        } finally {
          statement.close();
        }
      };
      const scores = () =>
        exec(
          'SELECT id,fts_score(body,?) AS score FROM docs ORDER BY score DESC LIMIT 100',
          query,
        );
      try {
        await exec('CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)');
        await exec(
          "INSERT INTO docs VALUES (1,'apple banana'),(2,'apple apple'),(3,'banana pear grape')",
        );
        await exec(create);
        const before = await scores();
        const beforeRows = await exec('SELECT * FROM docs ORDER BY id');
        await exec('BEGIN');
        if (mode === 'insert-delete') {
          await exec(
            "INSERT INTO docs VALUES (4,'apple apple apple apple apple')",
          );
          await exec('DELETE FROM docs WHERE id=4');
        }
        if (mode === 'delete-reinsert') {
          await exec('DELETE FROM docs WHERE id=1');
          await exec("INSERT INTO docs VALUES (1,'apple banana')");
        }
        if (mode === 'update-same')
          await exec("UPDATE docs SET body='apple banana' WHERE id=1");
        if (mode === 'replace-same')
          await exec("INSERT OR REPLACE INTO docs VALUES (1,'apple banana')");
        if (mode === 'insert-live')
          await exec("INSERT INTO docs VALUES (4,'apple banana grape')");
        if (mode === 'delete-live') await exec('DELETE FROM docs WHERE id=1');
        if (mode === 'repeat-update' || mode === 'rollback')
          for (let i = 0; i < 10; i++)
            await exec("UPDATE docs SET body='apple apple' WHERE id=2");
        await exec(mode === 'rollback' ? 'ROLLBACK' : 'COMMIT');
        const after = await scores();
        const afterRows = await exec('SELECT * FROM docs ORDER BY id');
        await exec('PRAGMA wal_checkpoint(TRUNCATE)');
        await db.close();
        db = await connect(path, options);
        const reopened = await scores();
        await exec('OPTIMIZE INDEX fts');
        const optimized = await scores();
        await exec('DROP INDEX fts');
        await exec(create);
        const rebuilt = await scores();
        assert.deepEqual(
          await exec('SELECT * FROM docs ORDER BY id'),
          afterRows,
        );
        if (!['insert-live', 'delete-live'].includes(mode)) {
          assert.deepEqual(afterRows, beforeRows);
          assert.deepEqual(rebuilt, before);
        }
        report.minimal.push({
          mode,
          multiprocess,
          beforeRows,
          afterRows,
          before,
          after,
          reopened,
          optimized,
          rebuilt,
        });
      } finally {
        await db.close();
      }
    }
  if (process.argv.includes('--audit')) {
    // Restore a disposable copy; never open or mutate the active project cache.
    const { SearchDb, CREATE_PASSAGE_FTS } =
      await import('../src/search/db.ts');
    const { searchSections } = await import('../src/search/search.ts');
    const base = new URL(
      '../tests/cases/hybrid/experiments/001-union-rrf/',
      import.meta.url,
    );
    const read = (name) => readFileSync(new URL(name, base));
    const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const manifest = JSON.parse(read('index-snapshot.json'));
    assert.equal(sha(read(manifest.file)), manifest.sha256);
    assert.equal(sha(read('scores.json.gz')), manifest.scoreSnapshotHash);
    const snapshot = JSON.parse(gunzipSync(read('scores.json.gz')));
    const path = join(dir, 'audit.db');
    writeFileSync(path, gunzipSync(read(manifest.file)));
    const db = new SearchDb(path, false);
    try {
      const labels = new Map();
      const original = JSON.parse(
        readFileSync(
          new URL(
            '../tests/cases/hybrid/real-query-audit/judgments.json',
            import.meta.url,
          ),
        ),
      );
      for (const j of original)
        for (const g of j.grades)
          labels.set(j.id + '\0' + g.sectionId, g.grade);
      for (const name of ['known-target-labels.json', 'pool-labels.json'])
        for (const g of JSON.parse(read(name)))
          labels.set(g.queryId + '\0' + g.sectionId, g.grade);
      const run = async () => {
        const rows = [];
        for (const q of snapshot.queries) {
          const engine = {
            ...snapshot.engine,
            countTokens: () => q.tokens,
            embed: async () => [q.vector],
          };
          const results = await searchSections(db, q.query, engine, 10);
          rows.push({
            id: q.id,
            query: q.query,
            results: results.map((r) => ({
              id: r.id,
              rankScore: r.rankScore,
              lexicalRank: r.lexicalRank,
              semanticRank: r.semanticRank,
              grade: labels.get(q.id + '\0' + r.id) ?? null,
            })),
          });
        }
        return rows;
      };
      const authoritative = async () =>
        JSON.stringify(
          (await db.execute('SELECT * FROM lexical_chunks ORDER BY id')).rows,
        );
      const rowsBefore = await authoritative();
      const before = await run();
      const optimizeStart = performance.now();
      await db.execute('OPTIMIZE INDEX chunks_fts');
      const optimizeMs = performance.now() - optimizeStart;
      const optimized = await run();
      const start = performance.now();
      await db.execute('BEGIN');
      await db.execute('DROP INDEX chunks_fts');
      await db.execute(CREATE_PASSAGE_FTS);
      await db.execute('COMMIT');
      const rebuildMs = performance.now() - start;
      assert.equal(await authoritative(), rowsBefore);
      const after = await run();
      const ids = (r, k) =>
        JSON.stringify(r.results.slice(0, k).map((x) => x.id));
      const changed = (k) =>
        before
          .filter((r, i) => ids(r, k) !== ids(after[i], k))
          .map((r) => r.id);
      report.audit = {
        indexHash: manifest.sha256,
        rebuildMs,
        optimizeMs,
        optimized,
        changedTop1: changed(1),
        changedTop5: changed(5),
        changedTop10: changed(10),
        before,
        after,
        unjudgedAfter: after.flatMap((r) =>
          r.results
            .filter((x) => x.grade === null)
            .map((x) => ({ queryId: r.id, sectionId: x.id })),
        ),
      };
    } finally {
      await db.close();
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
