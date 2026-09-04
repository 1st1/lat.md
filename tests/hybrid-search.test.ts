import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmbedder } from '@lat.md/embed';
import minilm from '@lat.md/embed-minilm-fp16';
import { analyzeMarkdownProject } from '../src/project-analysis.js';
import { chunkFile } from '../src/search/chunks.js';
import {
  SearchDb,
  ensureMeta,
  ensureSectionsSchema,
  setStoredModel,
  readManifest,
} from '../src/search/db.js';
import { lexicalTokens, LEXICAL_VERSION } from '../src/search/lexical.js';
import { stem, stemWords } from '@lat.md/stemmer';
import { indexSections } from '../src/search/index.js';
import {
  searchSections,
  collapse,
  collectSearchCandidates,
  rankSearchCandidates,
  BASELINE_RANKING,
} from '../src/search/search.js';
import { writeIndex } from '../src/search/cache.js';
import { formatResultList } from '../src/format.js';
import { plainStyler } from '../src/context.js';

const dirs: string[] = [];
function fixture(markdown: string) {
  const root = mkdtempSync(join(tmpdir(), 'lat-hybrid-'));
  dirs.push(root);
  const lat = join(root, 'lat.md');
  mkdirSync(lat);
  writeFileSync(join(lat, 'guide.md'), markdown);
  return { root, lat };
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
const simple = {
  name: 'local:test',
  dimensions: 2,
  maxInputTokens: 256,
  tokenizerFingerprint: 'characters-v1',
  countTokens: (t: string) => Array.from(t).length,
  embed: async (texts: string[]) =>
    texts.map((t) => (t.includes('needle') ? [1, 0] : [0, 1])),
};
async function indexed(markdown: string) {
  const f = fixture(markdown),
    db = new SearchDb(join(f.root, 'test.db'));
  await ensureMeta(db);
  await ensureSectionsSchema(db, 2);
  await indexSections(f.lat, db, simple);
  return { ...f, db };
}

describe('hybrid search', () => {
  // @lat: [[tests/search#Hybrid Retrieval#Stems English lexical fields and queries]]
  it('matches English word forms while preserving original evidence and exact identifiers', async () => {
    expect(stemWords(['LINKS', 'files', 'running'])).toEqual([
      'link',
      'file',
      'run',
    ]);
    expect(stem('')).toBe('');
    expect(stemWords([])).toEqual([]);
    expect(lexicalTokens('API_TOKEN café 中文 123')).toEqual([
      'api_token',
      'café',
      '中文',
      '123',
    ]);
    const f = await indexed(
      '# Guide\n\nOverview.\n\n## Link Syntax\n\nA file link references an external source. Use API_TOKEN.\n',
    );
    try {
      const results = await searchSections(f.db, 'links files sources', simple);
      const target = results.find((r) => r.heading === 'Link Syntax')!;
      expect(target.lexicalRank).toBe(1);
      expect(target.evidence[0].text).toContain(
        'A file link references an external source.',
      );
      expect((await searchSections(f.db, 'API_TOKEN', simple))[0].heading).toBe(
        'Link Syntax',
      );
      writeFileSync(
        join(f.lat, 'guide.md'),
        '# Guide\n\nOverview.\n\n## Link Syntax\n\nSockets connect databases.\n',
      );
      await indexSections(f.lat, f.db, simple);
      expect(
        (await searchSections(f.db, 'files sources', simple)).every(
          (r) => r.lexicalRank === undefined,
        ),
      ).toBe(true);
    } finally {
      await f.db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Upgrades lexical indexes without embedding again]]
  it('rebuilds legacy lexical data without embedding or changing source passages', async () => {
    const f = await indexed('# Guide\n\nA file contains links.');
    try {
      const before = (await f.db.execute('SELECT * FROM embeddings')).rows;
      await f.db.execute('DROP INDEX chunks_fts');
      await f.db.execute('DROP TABLE lexical_chunks');
      await f.db.execute("DELETE FROM meta WHERE key='lexical_version'");
      await f.db.execute(
        'CREATE INDEX chunks_fts ON chunks USING fts(body,heading,path)',
      );
      await ensureSectionsSchema(f.db, 2);
      const engine = { ...simple, embed: vi.fn(simple.embed) };
      await indexSections(f.lat, f.db, engine);
      expect(engine.embed).not.toHaveBeenCalled();
      expect((await f.db.execute('SELECT * FROM embeddings')).rows).toEqual(
        before,
      );
      expect(
        (
          await f.db.execute(
            "SELECT value FROM meta WHERE key='lexical_version'",
          )
        ).rows[0].value,
      ).toBe(LEXICAL_VERSION);
      expect((await searchSections(f.db, 'files', engine))[0].lexicalRank).toBe(
        1,
      );
    } finally {
      await f.db.close();
    }
  });

  // @lat: [[tests/search#Hybrid Retrieval#Preserves complete passage coverage]]
  it('covers oversized prose, lists, code, tables, and Unicode within tokenizer budgets', async () => {
    const text =
      '# Guide\n\n' +
      'Sentence with words. '.repeat(90) +
      '\n\n## Child\n\n- ' +
      'nested item '.repeat(80) +
      '\n  - child item\n\n```js\n' +
      'const_x=123;'.repeat(100) +
      '\n```\n\n| Name | Detail |\n| --- | --- |\n| entry | ' +
      '🚀cell '.repeat(100) +
      ' |\n';
    const f = fixture(text);
    const project = await analyzeMarkdownProject(f.lat, f.root, {
      executor: 'inline',
    });
    const file = [...project.files.values()][0];
    const chunks = chunkFile(file, project.sections, simple);
    expect(chunks.length).toBeGreaterThan(10);
    for (const p of chunks) {
      expect(simple.countTokens(p.input)).toBeLessThanOrEqual(256);
      expect(p.text).toBe(text.slice(p.spans[0].start, p.spans[0].end));
      expect(p.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
    for (const block of file.blocks.filter((b) => b.type !== 'heading'))
      for (let i = block.start; i < block.end; i++)
        if (text[i].trim())
          expect(
            chunks.some((p) => p.spans.some((s) => s.start <= i && s.end > i)),
            `uncovered ${i}`,
          ).toBe(true);
    const child = project.sections.find((s) => s.heading === 'Child')!;
    expect(
      chunks
        .filter((p) => p.text.includes('const_x'))
        .every((p) => p.sectionId === child.id),
    ).toBe(true);
  });
  // @lat: [[tests/search#Hybrid Retrieval#Rejects local embedding truncation]]
  it('uses the real local tokenizer and rejects oversized embedding input', async () => {
    const engine = await createEmbedder({ model: minilm });
    const text = 'token '.repeat(300);
    expect(engine.countTokens(text)).toBeGreaterThan(engine.maxInputTokens);
    await expect(engine.embed([text])).rejects.toThrow(/token limit/);
  });
  // @lat: [[tests/search#Hybrid Retrieval#Retrieves lexical evidence independently]]
  it('keeps exact identifiers below the semantic floor and returns source evidence', async () => {
    const f = await indexed(
      '# Guide\n\nneedle overview\n\n## Credentials\n\nAPI_TOKEN authenticates requests.',
    );
    try {
      const results = await searchSections(f.db, 'API_TOKEN', simple, 5, 1);
      expect(results[0].heading).toBe('Credentials');
      expect(results[0].lexicalRank).toBe(1);
      expect(results[0].evidence[0].text).toContain('API_TOKEN');
      const below = await searchSections(
        f.db,
        'needle API_TOKEN',
        simple,
        5,
        1,
      );
      expect(
        below.some(
          (r) =>
            r.heading === 'Credentials' && r.semanticSimilarity === undefined,
        ),
      ).toBe(true);
    } finally {
      await f.db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Collapses before rank fusion]]
  it('collapses repeated owners and gives equal scores equal section ranks', () => {
    const result = collapse([
      { id: 1, sectionId: 'a', score: 1 },
      { id: 2, sectionId: 'a', score: 0.9 },
      { id: 3, sectionId: 'b', score: 0.8 },
      { id: 4, sectionId: 'c', score: 0.8 },
    ]);
    expect([...result.values()].map((r) => r.rank)).toEqual([1, 2, 2]);
  });
  // @lat: [[tests/search#Hybrid Retrieval#Reuses vectors after source movement]]
  it('reuses embedding inputs when only source offsets move', async () => {
    const f = await indexed(
      '# Guide\n\nneedle body\n\n## Child\n\nAPI_TOKEN value',
    );
    try {
      const spy = vi.fn(simple.embed);
      const engine = { ...simple, embed: spy };
      writeFileSync(
        join(f.lat, 'guide.md'),
        '\n\n# Guide\n\nneedle body\n\n## Child\n\nAPI_TOKEN value',
      );
      await indexSections(f.lat, f.db, engine);
      expect(spy).not.toHaveBeenCalled();
      const p = (await searchSections(f.db, 'API_TOKEN', engine))[0]
        .evidence[0];
      expect(p.spans[0].startLine).toBe(9);
    } finally {
      await f.db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Reuses unchanged chunks within edited sections]]
  it('embeds only the changed passage in a multi-passage section', async () => {
    const paragraphs = ['alpha', 'bravo', 'delta'].map((word) =>
      `${word} `.repeat(25).trim(),
    );
    const markdown = `# Guide\n\n${paragraphs.join('\n\n')}`;
    const f = await indexed(markdown);
    try {
      const before = (
        await f.db.execute('SELECT input_hash FROM chunks ORDER BY ordinal')
      ).rows.map((r) => r.input_hash);
      expect(before).toHaveLength(3);
      const spy = vi.fn(simple.embed);
      writeFileSync(
        join(f.lat, 'guide.md'),
        markdown.replace('bravo', 'gamma'),
      );
      await indexSections(f.lat, f.db, { ...simple, embed: spy });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toHaveLength(1);
      expect(spy.mock.calls[0][0][0]).toContain('gamma');
      const after = (
        await f.db.execute('SELECT input_hash FROM chunks ORDER BY ordinal')
      ).rows.map((r) => r.input_hash);
      expect(after).toHaveLength(3);
      expect(after[0]).toBe(before[0]);
      expect(after[1]).not.toBe(before[1]);
      expect(after[2]).toBe(before[2]);
      const results = await searchSections(f.db, 'gamma', simple);
      expect(results[0].evidence.some((e) => e.text.includes('gamma'))).toBe(
        true,
      );
    } finally {
      await f.db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Rescores the candidate union without inventing matches]]
  it('fills truncated lexical scores while preserving genuine channel nonmatches', async () => {
    const markdown =
      '# Guide\n\nOverview.\n\n' +
      Array.from(
        { length: 105 },
        (_, i) => `## Filler ${i}\n\nneedle alpha`,
      ).join('\n\n') +
      '\n\n## Semantic target\n\nalpha semantic-target\n\n## Zero match\n\nsemantic-target';
    const f = fixture(markdown),
      db = new SearchDb(join(f.root, 'union.db'));
    const engine = {
      ...simple,
      embed: async (texts: string[]) =>
        texts.map((t) =>
          t === 'needle alpha' || t.includes('semantic-target')
            ? [1, 0]
            : [0, 1],
        ),
    };
    try {
      await ensureMeta(db);
      await ensureSectionsSchema(db, 2);
      await indexSections(f.lat, db, engine);
      const retrieved = await collectSearchCandidates(
        db,
        'needle alpha',
        engine,
      );
      const union = await collectSearchCandidates(
        db,
        'needle alpha',
        engine,
        5,
        0.2,
        'union',
      );
      const target = [...retrieved.semantic.list.keys()].find((id) =>
        id.endsWith('#Semantic target'),
      )!;
      const zero = [...retrieved.semantic.list.keys()].find((id) =>
        id.endsWith('#Zero match'),
      )!;
      expect(target).toBeTruthy();
      expect(zero).toBeTruthy();
      expect(retrieved.lexical.list.has(target)).toBe(false);
      expect(union.lexical.list.get(target)!.score).toBeGreaterThan(0);
      expect(union.lexical.list.has(zero)).toBe(false);
      expect(
        [...union.semantic.list.keys()].some((id) => id.includes('#Filler')),
      ).toBe(false);
      expect(
        [
          ...new Set([
            ...union.lexical.list.keys(),
            ...union.semantic.list.keys(),
          ]),
        ].sort(),
      ).toEqual(
        [
          ...new Set([
            ...retrieved.lexical.list.keys(),
            ...retrieved.semantic.list.keys(),
          ]),
        ].sort(),
      );
      expect(
        rankSearchCandidates(union, {
          ...BASELINE_RANKING,
          candidateScoring: 'union',
        })[0].id,
      ).toBe(target);
      const weighted = rankSearchCandidates(retrieved, {
        ...BASELINE_RANKING,
        semanticWeight: 2,
      });
      expect(
        weighted
          .slice(0, 2)
          .map((r) => r.id)
          .sort(),
      ).toEqual([target, zero].sort());
      const defaults = await searchSections(db, 'needle alpha', engine);
      expect(defaults.map((r) => r.id)).toEqual(
        rankSearchCandidates(retrieved).map((r) => r.id),
      );
    } finally {
      await db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Publishes only successful generations]]
  it('preserves the active generation when replacement fails', async () => {
    const f = fixture('# Guide\n\nneedle text');
    const cache = join(f.lat, '.cache');
    await writeIndex(f.lat, undefined, false, async (db) => {
      await ensureSectionsSchema(db, 2);
      await indexSections(f.lat, db, simple);
      await setStoredModel(db, 'local:test:2');
    });
    const before = readManifest(cache);
    await expect(
      writeIndex(f.lat, undefined, true, async () => {
        throw new Error('injected failure');
      }),
    ).rejects.toThrow('injected');
    expect(readManifest(cache)).toEqual(before);
    const db = new SearchDb(join(cache, before!.file));
    try {
      expect((await searchSections(db, 'needle', simple)).length).toBe(1);
    } finally {
      await db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Preserves FTS rollback and portable copies]]
  it('keeps FTS transactional and searchable after checkpoint and copy', async () => {
    const f = await indexed('# Guide\n\nneedle text');
    await f.db.execute('BEGIN');
    await f.db.execute("UPDATE chunks SET body='rollbackmarker'");
    await f.db.execute('ROLLBACK');
    expect(
      (
        await f.db.execute(
          "SELECT id FROM chunks WHERE fts_match(body,heading,path,'rollbackmarker')",
        )
      ).rows,
    ).toEqual([]);
    await f.db.checkpoint();
    await f.db.close();
    const copy = join(f.root, 'copy.db');
    await cp(join(f.root, 'test.db'), copy);
    const db = new SearchDb(copy);
    try {
      const hits = await searchSections(db, 'needle', simple);
      expect(hits[0].lexicalScore).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Switches preview without changing relevance]]
  it('formats passage, introduction, and both from the same match', () => {
    const section = {
      id: 'guide#Guide',
      file: 'guide',
      filePath: 'guide.md',
      heading: 'Guide',
      depth: 1,
      startLine: 1,
      endLine: 4,
      children: [],
      firstParagraph: 'Introduction text',
    };
    const matches = [
      {
        section,
        reason: 'hybrid match',
        rankScore: 0.03,
        evidence: [
          {
            chunkId: '1',
            text: 'Matching passage',
            spans: [],
            channel: 'lexical' as const,
          },
        ],
      },
    ];
    const ctx = {
      latDir: '/p/lat.md',
      projectRoot: '/p',
      mode: 'cli' as const,
      styler: plainStyler,
    };
    expect(
      formatResultList(ctx, 'Results', matches, { preview: 'passage' }),
    ).toContain('Matching passage');
    expect(
      formatResultList(ctx, 'Results', matches, { preview: 'intro' }),
    ).not.toContain('Matching passage');
    const both = formatResultList(ctx, 'Results', matches, { preview: 'both' });
    expect(both).toContain('Introduction text');
    expect(both).toContain('Matching passage');
  });
  // @lat: [[tests/search#Hybrid Retrieval#Archives legacy caches without overwriting backups]]
  it('archives legacy models and preserves existing backup files', async () => {
    const f = fixture('# Guide\n\nneedle');
    const cache = join(f.lat, '.cache');
    mkdirSync(cache);
    const old = join(cache, 'vectors.db');
    execFileSync(process.execPath, [
      join(import.meta.dirname, 'support', 'seed-legacy.mjs'),
      old,
      'local:test:2',
    ]);
    writeFileSync(old + '.old-12', 'existing backup');
    await writeIndex(f.lat, undefined, false, async (db, model) => {
      expect(model).toBe('local:test:2');
      await ensureSectionsSchema(db, 2);
      await indexSections(f.lat, db, simple);
      await setStoredModel(db, model!);
    });
    expect(readFileSync(old + '.old-12', 'utf8')).toBe('existing backup');
    expect(existsSync(old + '.old-12.1')).toBe(true);
    expect(existsSync(old)).toBe(false);
  });
  // @lat: [[tests/search#Hybrid Retrieval#Serializes concurrent index writers]]
  it('serializes writers and keeps an existing reader usable', async () => {
    const f = fixture('# Guide\n\nneedle');
    let active = 0,
      maximum = 0;
    const work = async (db: SearchDb) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((r) => setTimeout(r, 20));
      await ensureSectionsSchema(db, 2);
      await indexSections(f.lat, db, simple);
      await setStoredModel(db, 'local:test:2');
      active--;
    };
    await Promise.all([
      writeIndex(f.lat, undefined, false, work),
      writeIndex(f.lat, undefined, false, work),
    ]);
    expect(maximum).toBe(1);
    const manifest = readManifest(join(f.lat, '.cache'))!;
    const reader = new SearchDb(join(f.lat, '.cache', manifest.file));
    try {
      await searchSections(reader, 'needle', simple);
      await writeIndex(f.lat, undefined, true, work);
      expect((await searchSections(reader, 'needle', simple)).length).toBe(1);
    } finally {
      await reader.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Rejects invalid vectors before changing the index]]
  it('keeps existing data when embedding output is incomplete', async () => {
    const f = await indexed('# Guide\n\nneedle');
    try {
      writeFileSync(join(f.lat, 'guide.md'), '# Guide\n\nchanged body');
      await expect(
        indexSections(f.lat, f.db, { ...simple, embed: async () => [] }),
      ).rejects.toThrow('invalid vectors');
      expect(
        (await searchSections(f.db, 'needle', simple))[0].evidence[0].text,
      ).toBe('needle');
    } finally {
      await f.db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Validates hosted input and response ordering]]
  it('counts hosted tokens and orders returned vectors by input index', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      ),
    );
    const engine = await createEmbedder({
      key: 'REPLAY_LAT_LLM_KEY::http://example.invalid',
    });
    expect(engine.countTokens('token '.repeat(9000))).toBeGreaterThan(
      engine.maxInputTokens,
    );
    await expect(engine.embed(['token '.repeat(9000)])).rejects.toThrow(
      'token limit',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await engine.embed(['first', 'second'])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]!.body as string).input,
    ).toEqual(['first', 'second']);
  });
  // @lat: [[tests/search#Hybrid Retrieval#Overfetches toward unique sections]]
  it('overfetches past repeated owners and reports exhausted passage budgets', async () => {
    const f = await indexed('# Guide\n\nneedle');
    try {
      await f.db.execute('DROP INDEX chunks_fts');
      await f.db.execute('DELETE FROM chunks');
      await f.db.execute('DELETE FROM sections');
      await f.db.execute('DELETE FROM embeddings');
      await f.db.execute(
        "INSERT INTO embeddings VALUES ('shared',vector32('[0,1]'))",
      );
      await f.db.execute('BEGIN');
      for (let i = 0; i < 51; i++)
        await f.db.execute({
          sql: 'INSERT INTO sections VALUES (?,?,?,?,?,?,?,?)',
          args: [
            `owner${String(i).padStart(2, '0')}`,
            'guide',
            `Owner ${i}`,
            'intro',
            'hash',
            null,
            1,
            1,
          ],
        });
      for (let i = 0; i < 210; i++)
        await f.db.execute({
          sql: 'INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?)',
          args: [
            i + 1,
            `chunk${i}`,
            `owner${String(i < 160 ? 0 : i - 159).padStart(2, '0')}`,
            i,
            'paragraph',
            '[]',
            'ordinary text',
            'Heading',
            'Path',
            'shared',
          ],
        });
      await f.db.execute('COMMIT');
      await ensureSectionsSchema(f.db, 2);
      const hits = await searchSections(f.db, 'zeta', simple, 5);
      expect(hits.some((r) => r.id === 'owner01')).toBe(true);
      expect(hits[0].diagnostics.semanticCandidates).toBe(210);
      expect(hits[0].diagnostics.semanticCapped).toBe(false);
      await f.db.execute('DROP INDEX chunks_fts');
      await f.db.execute("UPDATE chunks SET section_id='owner00'");
      await f.db.execute('BEGIN');
      for (let i = 210; i < 600; i++)
        await f.db.execute({
          sql: 'INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?)',
          args: [
            i + 1,
            `chunk${i}`,
            'owner00',
            i,
            'paragraph',
            '[]',
            'ordinary text',
            'Heading',
            'Path',
            'shared',
          ],
        });
      await f.db.execute('COMMIT');
      await ensureSectionsSchema(f.db, 2);
      const capped = await searchSections(f.db, 'zeta', simple, 5);
      expect(capped).toHaveLength(1);
      expect(capped[0].diagnostics.semanticCapped).toBe(true);
    } finally {
      await f.db.close();
    }
  });
  // @lat: [[tests/search#Hybrid Retrieval#Keeps readers alive across process boundaries]]
  it.each(process.platform === 'win32' ? [true] : [false, true])(
    'publishes a replacement while another process reads the old FTS generation (private copy: %s)',
    async (snapshot) => {
      const f = fixture('# Guide\n\nneedle original');
      const build = (db: SearchDb) =>
        ensureSectionsSchema(db, 2).then(() =>
          indexSections(f.lat, db, simple),
        );
      await writeIndex(f.lat, undefined, false, build);
      const manifest = readManifest(join(f.lat, '.cache'))!;
      const child = fork(
        join(import.meta.dirname, 'support', 'search-reader.mjs'),
        [
          join(f.lat, '.cache', manifest.file),
          snapshot ? 'snapshot' : 'shared',
        ],
        { execArgv: [], silent: true },
      );
      let stderr = '';
      child.stderr!.on('data', (data) => {
        stderr += data;
      });
      try {
        const failed = once(child, 'exit').then(([code]) => {
          if (code !== 0) throw new Error(stderr || `reader exited ${code}`);
          return [];
        });
        expect((await Promise.race([once(child, 'message'), failed]))[0]).toBe(
          'ready',
        );
        writeFileSync(join(f.lat, 'guide.md'), '# Guide\n\nneedle replacement');
        await writeIndex(f.lat, undefined, false, build);
        const response = once(child, 'message');
        child.send('read');
        const [rows] = await Promise.race([response, failed]);
        expect(rows).toEqual([
          expect.objectContaining({
            body: 'needl origin',
            score: expect.any(Number),
          }),
        ]);
        if (child.exitCode === null) await once(child, 'exit');
      } finally {
        child.kill();
      }
    },
  );
});
