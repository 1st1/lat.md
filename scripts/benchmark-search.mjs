import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  SearchDb,
  CREATE_PASSAGE_FTS,
  ensureMeta,
  ensureSectionsSchema,
} from '../dist/src/search/db.js';
import { synchronizeLexical } from '../dist/src/search/lexical.js';
import { searchSections } from '../dist/src/search/search.js';
const output = {
  hardware: {
    cpu: cpus()[0]?.model,
    cpus: cpus().length,
    memoryBytes: totalmem(),
    node: process.version,
  },
  results: [],
};
for (const dimensions of process.env.LAT_BENCH_DIMENSIONS?.split(',').map(
  Number,
) ?? [384, 1536])
  for (const count of process.env.LAT_BENCH_CHUNKS?.split(',').map(Number) ?? [
    10000, 50000, 100000,
  ]) {
    const dir = await mkdtemp(join(tmpdir(), 'lat-search-bench-'));
    let db = new SearchDb(join(dir, 'bench.db'), false);
    try {
      await ensureMeta(db);
      await ensureSectionsSchema(db, dimensions);
      await db.execute('DROP INDEX chunks_fts');
      const vector = new Array(dimensions).fill(0);
      vector[0] = 1;
      const json = JSON.stringify(vector);
      const start = performance.now();
      await db.execute('BEGIN');
      for (let i = 0; i < 10000; i++)
        await db.execute({
          sql: 'INSERT INTO sections VALUES (?,?,?,?,?,?,?,?)',
          args: [
            `s${i}`,
            'guide',
            `Topic ${i}`,
            'overview',
            `${i}`,
            null,
            1,
            1,
          ],
        });
      for (let i = 0; i < count; i++) {
        await db.execute({
          sql: 'INSERT INTO embeddings VALUES (?,vector32(?))',
          args: [`h${i}`, json],
        });
        await db.execute({
          sql: 'INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?)',
          args: [
            i + 1,
            `p${i}`,
            `s${i % 10000}`,
            Math.floor(i / 10000),
            'paragraph',
            '[{"start":0,"end":20,"startLine":1,"endLine":1}]',
            `Recovery procedure ${i}: restore snapshot and replay committed transactions.`,
            `Topic ${i % 10000}`,
            'Operations',
            `h${i}`,
          ],
        });
      }
      await db.execute('COMMIT');
      console.error(
        `Loaded ${count} rows at ${dimensions} dimensions; checkpointing before FTS`,
      );
      await db.checkpoint();
      console.error(`Bulk checkpoint complete`);
      await synchronizeLexical(db);
      await db.execute(CREATE_PASSAGE_FTS);
      console.error(`Built FTS for ${count} rows; checkpointing`);
      await db.checkpoint();
      console.error(`Checkpoint complete for ${count} rows`);
      const indexingMs = performance.now() - start;
      await db.close();
      db = new SearchDb(join(dir, 'bench.db'));
      const engine = {
        name: 'benchmark',
        dimensions,
        maxInputTokens: 8191,
        tokenizerFingerprint: 'fixture',
        countTokens: () => 3,
        embed: async () => [vector],
      };
      const times = [];
      for (let n = 0; n < 11; n++) {
        const t = performance.now();
        await searchSections(db, 'restore snapshot', engine, 10);
        times.push(performance.now() - t);
      }
      const warm = times.slice(1).sort((a, b) => a - b),
        p95 = warm[Math.ceil(warm.length * 0.95) - 1];
      const row = {
        sections: 10000,
        chunks: count,
        dimensions,
        indexingMs,
        coldQueryMs: times[0],
        warmP95Ms: p95,
        cacheBytes: (await stat(db.path)).size,
        targetMet: count === 50000 ? p95 <= 500 : null,
      };
      output.results.push(row);
      console.log(JSON.stringify(row));
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
if (process.argv[2])
  await writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
