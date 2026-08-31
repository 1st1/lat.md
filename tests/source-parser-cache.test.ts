import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PARSER_CACHE_VERSION } from '../src/parser-cache.js';
import {
  SourceParserRuntime,
  clearSymbolCache,
  resolveSourceSymbol,
  sourceAnalysisCachePath,
  type SourceFileAnalysis,
} from '../src/source-parser.js';
import {
  SOURCE_FILE_EXTENSIONS,
  type SourceFileExtension,
} from '../src/source-formats.js';

const SOURCE_CACHE_FIXTURES = {
  '.c': { content: 'int cached(void) { return 1; }\n', symbol: 'cached' },
  '.dart': { content: 'int cached() => 1;\n', symbol: 'cached' },
  '.go': { content: 'package cache\nfunc Cached() {}\n', symbol: 'Cached' },
  '.h': { content: 'int cached(void);\n', symbol: 'cached' },
  '.java': { content: 'class Cached {}\n', symbol: 'Cached' },
  '.js': { content: 'export function cached() {}\n', symbol: 'cached' },
  '.jsx': {
    content: 'export function cached() { return <div /> }\n',
    symbol: 'cached',
  },
  '.py': { content: 'def cached():\n    return None\n', symbol: 'cached' },
  '.rs': { content: 'pub fn cached() {}\n', symbol: 'cached' },
  '.ts': { content: 'export function cached() {}\n', symbol: 'cached' },
  '.tsx': {
    content: 'export function cached() { return <div /> }\n',
    symbol: 'cached',
  },
} satisfies Record<SourceFileExtension, { content: string; symbol: string }>;

const roots: string[] = [];

async function createProject(): Promise<{ root: string; latDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'lat-source-cache-'));
  const latDir = join(root, 'lat.md');
  await mkdir(latDir);
  roots.push(root);
  return { root, latDir };
}

afterEach(async () => {
  clearSymbolCache();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('persistent source analysis cache', () => {
  // @lat: [[tests/analysis-tests#Caches every supported source language]]
  it('caches every supported source language without reparsing warm files', async () => {
    const { root, latDir } = await createProject();

    const cold: SourceFileAnalysis[] = [];
    const coldRuntime = new SourceParserRuntime();
    for (const extension of SOURCE_FILE_EXTENSIONS) {
      const source = SOURCE_CACHE_FIXTURES[extension];
      const filePath = `src/cached${extension}`;
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, filePath), source.content);
      const resolved = await resolveSourceSymbol(
        filePath,
        source.symbol,
        root,
        {
          latDir,
          runtime: coldRuntime,
          onFileAnalyzed: (analysis) => cold.push(analysis),
        },
      );
      expect(resolved.found, extension).toBe(true);
    }
    expect(cold).toHaveLength(SOURCE_FILE_EXTENSIONS.length);
    expect(cold.every(({ timings }) => timings.cacheStatus === 'miss')).toBe(
      true,
    );

    const warm: SourceFileAnalysis[] = [];
    const warmRuntime = new SourceParserRuntime();
    for (const extension of SOURCE_FILE_EXTENSIONS) {
      const source = SOURCE_CACHE_FIXTURES[extension];
      const resolved = await resolveSourceSymbol(
        `src/cached${extension}`,
        source.symbol,
        root,
        {
          latDir,
          runtime: warmRuntime,
          onFileAnalyzed: (analysis) => warm.push(analysis),
        },
      );
      expect(resolved.found, extension).toBe(true);
    }
    expect(warm).toHaveLength(SOURCE_FILE_EXTENSIONS.length);
    expect(warm.every(({ timings }) => timings.cacheStatus === 'hit')).toBe(
      true,
    );
    expect(warm.every(({ timings }) => timings.parseMs === 0)).toBe(true);

    const tsPath = join(root, 'src', 'cached.ts');
    const cachePath = sourceAnalysisCachePath(latDir, root, tsPath);
    const [header, payload] = (await readFile(cachePath, 'utf8')).split('\n');
    const hash = createHash('sha1')
      .update(SOURCE_CACHE_FIXTURES['.ts'].content)
      .digest('hex');
    expect(header).toBe(`v${PARSER_CACHE_VERSION}:${hash}`);
    expect(JSON.parse(payload)).toMatchObject({
      path: 'src/cached.ts',
      symbols: [{ name: 'cached', kind: 'function' }],
    });
  });

  // @lat: [[tests/analysis-tests#Invalidates source content and cache schemas]]
  it('invalidates changed source content and parser cache versions', async () => {
    const { root, latDir } = await createProject();
    const filePath = 'src/app.ts';
    const absolutePath = join(root, filePath);
    await mkdir(join(root, 'src'));
    await writeFile(absolutePath, 'export const oldValue = 1\n');

    await resolveSourceSymbol(filePath, 'oldValue', root, {
      latDir,
      runtime: new SourceParserRuntime(),
    });
    await writeFile(absolutePath, 'export const newValue = 2\n');
    const changed: SourceFileAnalysis[] = [];
    expect(
      (
        await resolveSourceSymbol(filePath, 'newValue', root, {
          latDir,
          runtime: new SourceParserRuntime(),
          onFileAnalyzed: (analysis) => changed.push(analysis),
        })
      ).found,
    ).toBe(true);
    expect(changed[0].timings.cacheStatus).toBe('miss');

    const cachePath = sourceAnalysisCachePath(latDir, root, absolutePath);
    const serialized = await readFile(cachePath, 'utf8');
    await writeFile(
      cachePath,
      serialized.replace(
        `v${PARSER_CACHE_VERSION}:`,
        `v${PARSER_CACHE_VERSION + 1}:`,
      ),
    );
    const versioned: SourceFileAnalysis[] = [];
    await resolveSourceSymbol(filePath, 'newValue', root, {
      latDir,
      runtime: new SourceParserRuntime(),
      onFileAnalyzed: (analysis) => versioned.push(analysis),
    });
    expect(versioned[0].timings.cacheStatus).toBe('miss');
    expect((await readFile(cachePath, 'utf8')).split('\n')[0]).toMatch(
      new RegExp(`^v${PARSER_CACHE_VERSION}:[a-f0-9]{40}$`),
    );
  });

  // @lat: [[tests/analysis-tests#Recovers from malformed source cache entries]]
  it('replaces malformed source cache entries', async () => {
    const { root, latDir } = await createProject();
    const filePath = 'src/app.ts';
    const absolutePath = join(root, filePath);
    await mkdir(join(root, 'src'));
    await writeFile(absolutePath, 'export function app() {}\n');
    await resolveSourceSymbol(filePath, 'app', root, {
      latDir,
      runtime: new SourceParserRuntime(),
    });

    const cachePath = sourceAnalysisCachePath(latDir, root, absolutePath);
    await writeFile(cachePath, 'partial cache entry');
    const analyses: SourceFileAnalysis[] = [];
    const result = await resolveSourceSymbol(filePath, 'app', root, {
      latDir,
      runtime: new SourceParserRuntime(),
      onFileAnalyzed: (analysis) => analyses.push(analysis),
    });
    expect(result.found).toBe(true);
    expect(analyses[0].timings.cacheStatus).toBe('miss');
    expect((await readFile(cachePath, 'utf8')).split('\n')[0]).toMatch(
      new RegExp(`^v${PARSER_CACHE_VERSION}:[a-f0-9]{40}$`),
    );
  });
});
