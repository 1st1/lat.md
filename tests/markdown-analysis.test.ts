import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeMarkdownFile } from '../src/markdown-analysis.js';
import {
  PARSER_CACHE_VERSION,
  markdownAnalysisCachePath,
} from '../src/markdown-analysis-cache.js';
import {
  analyzeMarkdownProject,
  MarkdownProjectSession,
} from '../src/project-analysis.js';
import type { ParserImportEvent } from '../src/parser-import.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function projectWithFiles(count: number): Promise<{
  root: string;
  latDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'lat-analysis-'));
  temporaryRoots.push(root);
  const latDir = join(root, 'lat.md');
  await mkdir(latDir);
  for (let index = 0; index < count; index++) {
    const name = index === 0 ? 'lat' : `file-${index}`;
    const next = index + 1 < count ? `file-${index + 1}` : 'lat';
    await writeFile(
      join(latDir, `${name}.md`),
      `# Section ${index}\n\nSummary ${index} links to [[${next}#Section ${
        index + 1 < count ? index + 1 : 0
      }]].\n`,
    );
  }
  return { root, latDir };
}

function semanticFiles(
  project: Awaited<ReturnType<typeof analyzeMarkdownProject>>,
) {
  return [...project.files].map(([path, file]) => [
    path,
    { ...file, timings: undefined },
  ]);
}

describe('Markdown analysis', () => {
  // @lat: [[tests/analysis-tests#Returns serializable file facts]]
  it('returns all file facts without retaining the AST', () => {
    const content = `---
lat:
  require-code-mention: true
---
# Overview

See [[other#Details]], [guide](guide.md), and [missing][nowhere].
`;
    const file = analyzeMarkdownFile(
      '/project/lat.md/lat.md',
      content,
      '/project/lat.md',
      '/project',
    );

    expect(file).not.toHaveProperty('tree');
    expect(() => JSON.stringify(file)).not.toThrow();
    expect(file.frontmatter.requireCodeMention).toBe(true);
    expect(file.sections[0].id).toBe('lat.md/lat#Overview');
    expect(file.wikiRefs.map((ref) => ref.target)).toEqual(['other#Details']);
    expect(file.markdownLinks).toContainEqual({
      kind: 'link',
      line: 7,
      url: 'guide.md',
    });
    expect(file.diagnostics).toContainEqual(
      expect.objectContaining({ rule: 'markdown-reference-definition' }),
    );
  });

  // @lat: [[tests/analysis-tests#Produces equivalent inline and worker snapshots]]
  it('produces equivalent inline and worker snapshots', async () => {
    const { root, latDir } = await projectWithFiles(8);
    const inline = await analyzeMarkdownProject(latDir, root, {
      executor: 'inline',
      cache: false,
    });
    const imports: ParserImportEvent[] = [];
    const workers = await analyzeMarkdownProject(latDir, root, {
      executor: 'workers',
      maxWorkers: 2,
      cache: false,
      onParserImport: (event) => imports.push(event),
    });

    expect(semanticFiles(workers)).toEqual(semanticFiles(inline));
    expect([...workers.sectionById]).toEqual([...inline.sectionById]);
    expect([...workers.incomingRefsBySection]).toEqual([
      ...inline.incomingRefsBySection,
    ]);
    expect(imports).toHaveLength(2);
    expect(imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parser: 'Markdown analyzer',
          imported: true,
          detail: 'worker 1',
        }),
        expect.objectContaining({
          parser: 'Markdown analyzer',
          imported: true,
          detail: 'worker 2',
        }),
      ]),
    );
  });

  // @lat: [[tests/analysis-tests#Reuses one command session snapshot]]
  it('reuses one project snapshot within a command session', async () => {
    const { root, latDir } = await projectWithFiles(2);
    const session = new MarkdownProjectSession(latDir, root, {
      executor: 'inline',
    });

    const first = await session.analysis();
    expect(await session.analysis()).toBe(first);
  });

  // @lat: [[tests/analysis-tests#Persists and reuses unchanged file analysis]]
  it('persists and reuses unchanged file analysis', async () => {
    const { root, latDir } = await projectWithFiles(1);
    const absolutePath = join(latDir, 'lat.md');
    const first = await analyzeMarkdownProject(latDir, root, {
      executor: 'inline',
    });
    const firstFile = first.files.get('lat.md')!;
    const cachePath = markdownAnalysisCachePath(latDir, root, absolutePath);
    const serialized = await readFile(cachePath, 'utf8');
    const newline = serialized.indexOf('\n');
    const contentHash = createHash('sha1')
      .update(firstFile.content)
      .digest('hex');
    const cached = JSON.parse(serialized.slice(newline + 1));

    expect(firstFile.timings.cacheStatus).toBe('miss');
    expect(serialized.slice(0, newline)).toBe(
      `v${PARSER_CACHE_VERSION}:${contentHash}`,
    );
    expect(cached.path).toBe('lat.md');

    const second = await analyzeMarkdownProject(latDir, root, {
      executor: 'workers',
      maxWorkers: 2,
    });
    const secondFile = second.files.get('lat.md')!;
    expect(secondFile.timings.cacheStatus).toBe('hit');
    expect(secondFile.timings.parseMs).toBe(0);
    expect({ ...secondFile, timings: undefined }).toEqual({
      ...firstFile,
      timings: undefined,
    });
  });

  // @lat: [[tests/analysis-tests#Invalidates changed content and cache schemas]]
  it('invalidates changed content and cache schemas', async () => {
    const { root, latDir } = await projectWithFiles(1);
    const absolutePath = join(latDir, 'lat.md');
    const cachePath = markdownAnalysisCachePath(latDir, root, absolutePath);
    await analyzeMarkdownProject(latDir, root, { executor: 'inline' });
    const before = await readFile(cachePath, 'utf8');

    await writeFile(
      absolutePath,
      '# Changed\n\nNow links to [[lat#Changed]].\n',
    );
    const changed = await analyzeMarkdownProject(latDir, root, {
      executor: 'inline',
    });
    expect(changed.files.get('lat.md')!.timings.cacheStatus).toBe('miss');
    expect(await readFile(cachePath, 'utf8')).not.toBe(before);

    const serialized = await readFile(cachePath, 'utf8');
    const newline = serialized.indexOf('\n');
    await writeFile(
      cachePath,
      `v${PARSER_CACHE_VERSION + 1}:${
        serialized.slice(0, newline).split(':')[1]
      }\n${serialized.slice(newline + 1)}`,
    );
    const staleSchema = await analyzeMarkdownProject(latDir, root, {
      executor: 'inline',
    });
    expect(staleSchema.files.get('lat.md')!.timings.cacheStatus).toBe('miss');
    const refreshed = await readFile(cachePath, 'utf8');
    expect(refreshed.slice(0, refreshed.indexOf('\n'))).toMatch(
      new RegExp(`^v${PARSER_CACHE_VERSION}:[a-f0-9]{40}$`),
    );
  });

  // @lat: [[tests/analysis-tests#Recovers from malformed cache entries]]
  it('recovers from malformed cache entries', async () => {
    const { root, latDir } = await projectWithFiles(1);
    const absolutePath = join(latDir, 'lat.md');
    const cachePath = markdownAnalysisCachePath(latDir, root, absolutePath);
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, 'not a cache entry');

    const project = await analyzeMarkdownProject(latDir, root, {
      executor: 'inline',
    });
    expect(project.files.get('lat.md')!.timings.cacheStatus).toBe('miss');
    const serialized = await readFile(cachePath, 'utf8');
    expect(serialized).toMatch(
      new RegExp(`^v${PARSER_CACHE_VERSION}:[a-f0-9]{40}\\n\\{`),
    );
  });

  // @lat: [[tests/analysis-tests#Uses collision-safe sharded cache paths]]
  it('uses collision-safe sharded cache paths', async () => {
    const { root, latDir } = await projectWithFiles(1);
    const nested = markdownAnalysisCachePath(
      latDir,
      root,
      join(latDir, 'Alpha', 'Beta.md'),
    );
    const dotted = markdownAnalysisCachePath(
      latDir,
      root,
      join(latDir, 'Alpha.Beta.md'),
    );
    const shard = basename(dirname(nested));

    expect(nested).not.toBe(dotted);
    expect(shard).toBe('be');
    expect(basename(nested)).toMatch(/^[a-f0-9]{40}_lat_md_alpha_beta_md$/);
  });
});
