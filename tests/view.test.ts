import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainStyler, type CmdContext } from '../src/context.js';
import { scanCodeRefs } from '../src/code-refs.js';
import { uiCommand } from '../src/cli/ui.js';
import { uiBuildCommand } from '../src/cli/ui-build.js';
import { parseSections } from '../src/lattice.js';
import { parse } from '../src/parser.js';
import {
  DEFAULT_VIEW_PORT,
  startViewServer,
  type ViewServer,
} from '../src/view/server.js';
import {
  normalizeStaticViewBasePath,
  staticViewUrl,
} from '../src/view/static-build.js';
import type {
  ViewStaticManifest,
  ViewStaticSourceFile,
  ViewStaticSourceView,
} from '../src/view/static-protocol.js';
import { highlightSource } from '../src/view/highlight.js';
import { buildGitDiffTree } from '../src/view/git-diff.js';
import { renderMarkdown } from '../src/view/markdown.js';
import type {
  ViewDocument,
  ViewGraph,
  ViewIndex,
  ViewSearchResponse,
  ViewSourceDocument,
} from '../src/view/protocol.js';
import { createViewSearch } from '../src/view/search.js';
import { buildViewTableOfContents } from '../src/view/table-of-contents.js';
import {
  activeDocumentTocId,
  centeredDocumentTocScrollTop,
  documentTocActivationLine,
  documentTocIndentationDepth,
} from '../view/src/document-toc.js';
import {
  buildFileTree,
  directoryIndex,
  expandDirectory,
  fileTreeErrorCount,
  fileTreeGitStatus,
} from '../view/src/file-tree.js';
import {
  graphInspectorLinkUrl,
  graphModeStorageKey,
  graphNode,
  graphNodeIdForUrl,
  graphSelectionForUrl,
  graphTarget,
  graphTargetForNode,
  graphUrl,
  historyScrollPosition,
  historyStateWithScroll,
  isSameMarkdownDocument,
  readGraphMode,
  scrollToDocumentLocation,
  searchButtonAction,
  searchEscapeAction,
  searchHistoryState,
  searchQuery,
  searchReturnTo,
  searchUrl,
  viewRouteIdentity,
  writeGraphMode,
} from '../view/src/navigation.js';
import {
  parseGeoJson,
  parseStl,
  parseTopoJson,
} from '../view/src/markdown-rich-fences.js';
import { renderSectionBackReferences } from '../view/src/section-back-references.js';
import {
  captureScrollAnchor,
  restoreScrollAnchor,
} from '../view/src/scroll-anchor.js';
import {
  getSourceWindow,
  getSourceWindowRows,
} from '../view/src/source-window.js';
import { staticViewAssetUrl } from '../view/src/static-mode.js';
import {
  deterministicGraphPosition,
  graphDisplayLabel,
  graphNodeSize,
  graphSearchNodeScores,
  graphSearchNodeSizes,
  staticGraphPositions,
  validGraphPosition,
} from '../view/src/graph-layout.js';

const projectRoot = join(import.meta.dirname, 'cases', 'view-project');
const latDir = join(projectRoot, 'lat.md');

function testContext(): CmdContext {
  return { latDir, projectRoot, styler: plainStyler, mode: 'cli' };
}

describe('lat ui', () => {
  let clientDir: string;
  let view: ViewServer;
  const runIndex = vi.fn(async () => {});
  const runSearch = vi.fn(async (_latDir: string, query: string) => ({
    query,
    matches: [
      {
        reason: 'semantic match',
        score: 0.82,
        section: {
          id: 'lat.md/guide#Guide#Details',
          heading: 'Details',
          depth: 2,
          file: 'lat.md/guide',
          filePath: 'lat.md/guide.md',
          children: [],
          startLine: 12,
          endLine: 16,
          firstParagraph: 'Relative Markdown links preserve heading fragments.',
          githubSlug: 'details',
        },
      },
    ],
  }));

  beforeAll(async () => {
    clientDir = mkdtempSync(join(tmpdir(), 'lat-view-client-'));
    mkdirSync(join(clientDir, 'assets'));
    writeFileSync(
      join(clientDir, 'index.html'),
      '<!doctype html><html><head><script type="module" src="/assets/app.js"></script></head><body><main>lat ui shell</main></body></html>',
    );
    writeFileSync(join(clientDir, 'assets', 'app.js'), 'export {};');
    view = await startViewServer(testContext(), {
      clientDir,
      git: false,
      search: createViewSearch(latDir, { runIndex, runSearch }),
    });
  });

  afterAll(async () => {
    await view.close();
    rmSync(clientDir, { recursive: true, force: true });
  });

  // @lat: [[lat.md/view/specs#View Tests#Serves the document index and browser shell]]
  it('serves the document index and browser shell', async () => {
    const indexResponse = await fetch(new URL('/api/index', view.url));
    expect(indexResponse.status).toBe(200);
    expect((await indexResponse.json()) as ViewIndex).toEqual({
      files: ['guide.md', 'lat.md'],
      entry: 'lat.md',
      errorCounts: {},
      git: null,
      logoText: 'lat.md',
    });

    const rootResponse = await fetch(view.url, { redirect: 'manual' });
    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.get('location')).toBe('/docs/lat.md');

    const shellResponse = await fetch(new URL('/docs/guide.md', view.url));
    expect(shellResponse.status).toBe(200);
    expect(await shellResponse.text()).toContain('lat ui shell');

    const sourceShell = await fetch(new URL('/code/src/app.ts', view.url));
    expect(sourceShell.status).toBe(200);
    expect(await sourceShell.text()).toContain('lat ui shell');

    const searchShell = await fetch(new URL('/search', view.url));
    expect(searchShell.status).toBe(200);
    expect(await searchShell.text()).toContain('lat ui shell');

    const app = readFileSync(
      join(import.meta.dirname, '..', 'view', 'src', 'App.tsx'),
      'utf8',
    );
    const styles = readFileSync(
      join(import.meta.dirname, '..', 'view', 'src', 'styles.css'),
      'utf8',
    );
    expect(app).toContain('../../website/public/logo.svg?url');
    expect(app).toContain('brandText === DEFAULT_VIEW_LOGO_TEXT');
    expect(app).toContain('<BrandText text={brandText} />');
    expect(app).toContain('src={staticViewAssetUrl(latLogoUrl)}');
    expect(styles).toContain('.brand-logo');
  });

  // @lat: [[lat.md/view/specs#View Tests#Builds a static deployment]]
  it('builds a static deployment without live Git or search services', async () => {
    expect(normalizeStaticViewBasePath('/project')).toBe('/project/');
    expect(staticViewUrl('/graph?node=document%3Alat.md', '/project/')).toBe(
      '/project/graph/?node=document%3Alat.md',
    );
    expect(staticViewAssetUrl('/assets/logo.svg', '/project/')).toBe(
      '/project/assets/logo.svg',
    );
    expect(staticViewAssetUrl('/assets/logo.svg', '/')).toBe(
      '/assets/logo.svg',
    );
    expect(() => normalizeStaticViewBasePath('project')).toThrow(
      'absolute URL path',
    );

    const buildRoot = mkdtempSync(join(tmpdir(), 'lat-ui-build-test-'));
    const staticProjectRoot = join(buildRoot, 'project');
    cpSync(projectRoot, staticProjectRoot, { recursive: true });
    const staticContext: CmdContext = {
      ...testContext(),
      projectRoot: staticProjectRoot,
      latDir: join(staticProjectRoot, 'lat.md'),
    };
    const outputDir = join(staticProjectRoot, 'site');
    try {
      const result = await uiBuildCommand(staticContext, outputDir, {
        basePath: '/project',
        clientDir,
        logoText: 'Project Atlas',
      });
      expect(result.output).toMatch(
        /Built 2 documents and [1-9]\d* source views/,
      );
      expect(result.output).toContain(outputDir);

      const payloadDir = join(outputDir, 'project');
      const manifest = JSON.parse(
        readFileSync(join(payloadDir, 'data', 'manifest.json'), 'utf8'),
      ) as ViewStaticManifest;
      expect(manifest.version).toBe(1);
      expect(manifest.index).toEqual({
        files: ['guide.md', 'lat.md'],
        entry: 'lat.md',
        errorCounts: {},
        git: null,
        logoText: 'Project Atlas',
      });
      expect(Object.keys(manifest.documents).sort()).toEqual([
        'guide.md',
        'lat.md',
      ]);
      const sourceEntries = Object.values(manifest.sources);
      expect(sourceEntries.length).toBeGreaterThan(1);
      const sourceFilePaths = new Set(sourceEntries.map((entry) => entry.file));
      expect(sourceFilePaths.size).toBe(1);
      expect([...sourceFilePaths][0]).toMatch(
        /^data\/source-files\/[a-f0-9]{20}\.json$/,
      );
      expect(new Set(sourceEntries.map((entry) => entry.view)).size).toBe(
        sourceEntries.length,
      );

      const sourceFile = JSON.parse(
        readFileSync(join(payloadDir, sourceEntries[0].file), 'utf8'),
      ) as ViewStaticSourceFile;
      const sourceView = JSON.parse(
        readFileSync(join(payloadDir, sourceEntries[0].view), 'utf8'),
      ) as ViewStaticSourceView;
      expect(sourceFile.path).toBe('src/app.ts');
      expect(sourceFile.content).toContain('export function run');
      expect(sourceFile.highlightedHtmlLines.length).toBeGreaterThan(0);
      expect(sourceView).toHaveProperty('focus');
      expect(sourceView).not.toHaveProperty('content');
      expect({ ...sourceFile, ...sourceView }).toHaveProperty(
        'otherReferences',
      );

      const document = JSON.parse(
        readFileSync(join(payloadDir, manifest.documents['lat.md']), 'utf8'),
      ) as ViewDocument;
      expect(document.gitHtml).toBeNull();
      expect(document.html).toContain('href="/project/docs/guide.md/#details"');
      expect(document.html).toContain('href="/project/code/src/app.ts/?from=');

      const graph = JSON.parse(
        readFileSync(join(payloadDir, manifest.graph), 'utf8'),
      ) as ViewGraph;
      expect(graph.nodes.every((node) => node.gitStatus === undefined)).toBe(
        true,
      );
      expect(graph.nodes.map((node) => node.url)).toContain(
        '/project/docs/lat.md/',
      );
      expect(graph.nodes.some((node) => node.kind === 'source')).toBe(true);

      expect(existsSync(join(payloadDir, 'docs', 'lat.md', 'index.html'))).toBe(
        true,
      );
      expect(
        existsSync(join(payloadDir, 'code', 'src', 'app.ts', 'index.html')),
      ).toBe(true);
      expect(existsSync(join(payloadDir, 'data', 'source-files'))).toBe(true);
      expect(existsSync(join(payloadDir, 'data', 'source-views'))).toBe(true);
      expect(existsSync(join(payloadDir, 'graph', 'index.html'))).toBe(true);
      expect(existsSync(join(payloadDir, 'search', 'index.html'))).toBe(false);
      expect(existsSync(join(payloadDir, 'assets', 'app.js'))).toBe(true);
      expect(existsSync(join(outputDir, 'assets'))).toBe(false);
      expect(existsSync(join(outputDir, 'data'))).toBe(false);

      const shell = readFileSync(
        join(payloadDir, 'docs', 'lat.md', 'index.html'),
        'utf8',
      );
      expect(shell).toContain('/project/assets/app.js');
      expect(shell).toContain(
        'globalThis.__LAT_STATIC_VIEW__={"basePath":"/project/"}',
      );
      expect(readFileSync(join(outputDir, 'index.html'), 'utf8')).toContain(
        '/project/docs/lat.md/',
      );
      expect(readFileSync(join(payloadDir, 'index.html'), 'utf8')).toContain(
        '/project/docs/lat.md/',
      );

      const scanned = await scanCodeRefs(staticProjectRoot);
      expect(
        scanned.refs.some((reference) => reference.file.startsWith('site/')),
      ).toBe(false);
      expect(
        scanned.files.some((path) => path.startsWith(`${outputDir}/`)),
      ).toBe(false);
      const disableRipgrep = process.env._LAT_DISABLE_RG;
      process.env._LAT_DISABLE_RG = '1';
      try {
        const fallbackScan = await scanCodeRefs(staticProjectRoot);
        expect(fallbackScan.usedRg).toBe(false);
        expect(
          fallbackScan.files.some((path) => path.startsWith(`${outputDir}/`)),
        ).toBe(false);
      } finally {
        if (disableRipgrep === undefined) delete process.env._LAT_DISABLE_RG;
        else process.env._LAT_DISABLE_RG = disableRipgrep;
      }

      await expect(
        uiBuildCommand(staticContext, outputDir, {
          basePath: '/project',
          clientDir,
        }),
      ).resolves.toEqual({
        output: `Static UI output already exists: ${outputDir}`,
        isError: true,
      });

      const emptyOutput = join(staticProjectRoot, 'empty-output');
      mkdirSync(emptyOutput);
      await expect(
        uiBuildCommand(staticContext, emptyOutput, {
          basePath: '/project',
          clientDir: join(staticProjectRoot, 'missing-client'),
        }),
      ).resolves.toEqual({
        output: `Static UI output already exists: ${emptyOutput}`,
        isError: true,
      });
    } finally {
      rmSync(buildRoot, { recursive: true, force: true });
    }
  });

  // @lat: [[lat.md/view/specs#View Tests#Builds the website wiki from published embedding packages]]
  it('builds the website wiki without compiling workspace embedding packages', () => {
    const repositoryRoot = join(import.meta.dirname, '..');
    const websitePackage = JSON.parse(
      readFileSync(join(repositoryRoot, 'website', 'package.json'), 'utf8'),
    ) as {
      devDependencies: Record<string, string>;
    };
    expect(websitePackage.devDependencies).toMatchObject({
      '@lat.md/embed': 'npm:@lat.md/embed@0.2.0',
      '@lat.md/embed-minilm-fp16': 'npm:@lat.md/embed-minilm-fp16@0.1.0',
    });

    const buildConfig = JSON.parse(
      readFileSync(
        join(repositoryRoot, 'website', 'tsconfig.lat-build.json'),
        'utf8',
      ),
    ) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    expect(buildConfig.compilerOptions.paths).toEqual({
      '@lat.md/embed': ['./node_modules/@lat.md/embed/dist/index.d.ts'],
      '@lat.md/embed-minilm-fp16': [
        './node_modules/@lat.md/embed-minilm-fp16/dist/index.d.ts',
      ],
    });

    const buildScript = readFileSync(
      join(repositoryRoot, 'website', 'scripts', 'build-wiki.mjs'),
      'utf8',
    );
    expect(buildScript).toContain('tsconfig.lat-build.json');
    expect(buildScript).toContain("'build:view'");
    expect(buildScript).not.toContain("'buildall'");
  });

  // @lat: [[lat.md/view/specs#View Tests#Renders the graph workspace]]
  it('serves the cached graph projection and graph shell', async () => {
    const shell = await fetch(new URL('/graph', view.url));
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('lat ui shell');

    const response = await fetch(new URL('/api/graph', view.url));
    expect(response.status).toBe(200);
    const graph = (await response.json()) as ViewGraph;
    expect(graph.generation).toBe(view.store.snapshot.generation);
    expect(graph.nodes.map((node) => [node.id, node.kind])).toEqual([
      ['code-ref:src/app.ts:5', 'code-reference'],
      ['document:guide.md', 'document'],
      ['document:lat.md', 'document'],
      ['source:src/app.ts', 'source'],
      ['source:src/app.ts#run', 'source'],
    ]);
    expect(
      graph.edges.find(
        (edge) =>
          edge.from === 'document:lat.md' &&
          edge.to === 'document:guide.md' &&
          edge.kind === 'wiki',
      ),
    ).toMatchObject({ weight: 5 });
    expect(
      graph.edges.find((edge) => edge.kind === 'code-mention'),
    ).toMatchObject({
      from: 'code-ref:src/app.ts:5',
      to: 'document:guide.md',
      weight: 1,
    });
    expect(graph.edges.some((edge) => edge.from === edge.to)).toBe(false);
    expect(
      graph.nodes.find((node) => node.id === 'document:lat.md'),
    ).toMatchObject({ inDegree: 1, outDegree: 10 });
    expect(
      graph.nodes.find((node) => node.id === 'document:guide.md'),
    ).toMatchObject({ inDegree: 8, outDegree: 2 });

    expect(graphUrl('document:guide.md')).toBe(
      '/graph?node=document%3Aguide.md',
    );
    expect(graphNode('?node=document%3Aguide.md')).toBe('document:guide.md');
    const sectionTarget = '/docs/guide.md#details';
    const targetedGraphUrl = graphUrl('document:guide.md', sectionTarget);
    expect(targetedGraphUrl).toBe(
      '/graph?node=document%3Aguide.md&target=%2Fdocs%2Fguide.md%23details',
    );
    expect(graphTarget(new URL(targetedGraphUrl, view.url).search)).toBe(
      sectionTarget,
    );
    const stored = new Map<string, string>();
    const graphModeStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      removeItem: (key: string) => void stored.delete(key),
      setItem: (key: string, value: string) => void stored.set(key, value),
    };
    const liveGraphModeKey = graphModeStorageKey(null);
    const staticGraphModeKey = graphModeStorageKey('/wiki/');
    expect(liveGraphModeKey).not.toBe(staticGraphModeKey);
    expect(readGraphMode(graphModeStorage, liveGraphModeKey)).toBe(false);
    writeGraphMode(graphModeStorage, liveGraphModeKey, true);
    expect(readGraphMode(graphModeStorage, liveGraphModeKey)).toBe(true);
    writeGraphMode(graphModeStorage, liveGraphModeKey, false);
    expect(readGraphMode(graphModeStorage, liveGraphModeKey)).toBe(false);
    expect(graphNodeIdForUrl(new URL(sectionTarget, view.url))).toBe(
      'document:guide.md',
    );
    expect(graphNodeIdForUrl(new URL('/code/src/app.ts?at=5', view.url))).toBe(
      'code-ref:src/app.ts:5',
    );
    expect(graphNodeIdForUrl(new URL('/code/src/app.ts#run', view.url))).toBe(
      'source:src/app.ts#run',
    );
    expect(
      graphSelectionForUrl(graph, new URL(sectionTarget, view.url)),
    ).toEqual({
      nodeId: 'document:guide.md',
      target: sectionTarget,
    });
    const documentNode = graph.nodes.find(
      (node) => node.id === 'document:guide.md',
    );
    expect(documentNode).toBeDefined();
    expect(
      graphTargetForNode(graph, documentNode!, sectionTarget, view.url),
    ).toBe(sectionTarget);
    expect(
      graphTargetForNode(graph, documentNode!, '/docs/lat.md', view.url),
    ).toBe(documentNode!.url);
    const sameDocumentLink = graphInspectorLinkUrl(
      '#details',
      '/docs/guide.md',
      view.url,
    );
    expect(`${sameDocumentLink?.pathname}${sameDocumentLink?.hash}`).toBe(
      sectionTarget,
    );
    expect(
      graphSelectionForUrl(
        graph,
        new URL(
          '/code/src/app.ts?from=lat.md%2Flat%23View+Project&line=16#run',
          view.url,
        ),
      ),
    ).toEqual({
      nodeId: 'source:src/app.ts#run',
      target: '/code/src/app.ts?from=lat.md%2Flat%23View+Project&line=16#run',
    });
    expect(
      graphSelectionForUrl(graph, new URL('/code/src/app.ts?at=5', view.url)),
    ).toEqual({
      nodeId: 'code-ref:src/app.ts:5',
      target: '/code/src/app.ts?at=5',
    });
    expect(
      graphDisplayLabel({
        kind: 'document',
        label: 'Graph',
        breadcrumbs: ['view', 'graph'],
      }),
    ).toBe('view › Graph');
    expect(
      graphDisplayLabel({
        kind: 'code-reference',
        label: 'app.ts:5',
        breadcrumbs: ['src', 'app.ts', 'line 5'],
        sourcePath: 'src/app.ts',
      }),
    ).toBe('src › app.ts:5');
    expect(
      validGraphPosition(deterministicGraphPosition('code-ref:src/app.ts:5')),
    ).toBe(true);
    expect(validGraphPosition({ x: Number.NaN, y: 1 })).toBe(false);
    expect(graphNodeSize(0)).toBe(5);
    expect(graphNodeSize(7)).toBeGreaterThan(graphNodeSize(1));
    expect(graphNodeSize(-1)).toBe(5);
    const positions = staticGraphPositions(graph);
    expect(positions.size).toBe(graph.nodes.length);
    expect([...positions.values()].every(validGraphPosition)).toBe(true);
    expect([...staticGraphPositions(graph)]).toEqual([...positions]);
    const searchScores = graphSearchNodeScores(
      graph,
      new Map([['guide.md', 0.82]]),
    );
    expect([...searchScores.keys()].sort()).toEqual([
      'code-ref:src/app.ts:5',
      'document:guide.md',
      'source:src/app.ts#run',
    ]);
    expect([...searchScores.values()]).toEqual([0.82, 0.82, 0.82]);
    expect(
      graphSearchNodeSizes(
        new Map([
          ['weak', 0.2],
          ['strong', 0.8],
        ]),
      ),
    ).toEqual(
      new Map([
        ['weak', 5],
        ['strong', 14],
      ]),
    );
    expect(graphSearchNodeSizes(new Map([['only', 0.5]])).get('only')).toBe(14);

    const styles = readFileSync(
      join(import.meta.dirname, '..', 'view', 'src', 'styles.css'),
      'utf8',
    );
    expect(styles).toContain('flex: 0 0 212px;');
    expect(styles).toContain('padding: 0 18px 0 28px;');
  });

  // @lat: [[lat.md/view/specs#View Tests#Searches sections with embeddings]]
  it('serves lazily indexed semantic section search', async () => {
    expect(searchUrl('runner details')).toBe('/search?q=runner+details');
    expect(searchQuery('?q=runner+details')).toBe('runner details');
    expect(searchUrl('')).toBe('/search');
    expect(searchReturnTo(searchHistoryState('/docs/guide.md#details'))).toBe(
      '/docs/guide.md#details',
    );
    expect(searchReturnTo(null)).toBeNull();
    expect(searchEscapeAction('runner details')).toBe('clear');
    expect(searchEscapeAction('')).toBe('close');
    expect(searchButtonAction('/docs/guide.md')).toBe('open');
    expect(searchButtonAction('/search')).toBe('close');

    const emptyResponse = await fetch(new URL('/api/search?query=', view.url));
    expect((await emptyResponse.json()) as ViewSearchResponse).toEqual({
      query: '',
      results: [],
    });
    expect(runIndex).not.toHaveBeenCalled();

    const response = await fetch(
      new URL('/api/search?query=runner%20details', view.url),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as ViewSearchResponse).toEqual({
      query: 'runner details',
      results: [
        {
          sectionId: 'lat.md/guide#Guide#Details',
          title: 'Details',
          path: 'guide.md',
          breadcrumbs: ['guide', 'Guide', 'Details'],
          description: 'Relative Markdown links preserve heading fragments.',
          url: '/docs/guide.md#details',
          score: 0.82,
        },
      ],
    });
    expect(runIndex).toHaveBeenCalledTimes(1);
    expect(runSearch).toHaveBeenCalledWith(latDir, 'runner details', 10, {
      buildIndex: false,
    });

    await fetch(new URL('/api/search?query=another', view.url));
    expect(runIndex).toHaveBeenCalledTimes(1);
  });

  // @lat: [[lat.md/view/specs#View Tests#Refreshes search after Markdown changes]]
  it('shares one incremental search index update per Markdown generation', async () => {
    let generation = 0;
    const index = vi.fn(async () => {});
    const search = vi.fn(async (_latDir: string, query: string) => ({
      query,
      matches: [],
    }));
    const viewSearch = createViewSearch(
      latDir,
      { runIndex: index, runSearch: search },
      () => generation,
    );

    await viewSearch('first');
    await viewSearch('second');
    expect(index).toHaveBeenCalledTimes(1);

    generation++;
    await Promise.all([viewSearch('third'), viewSearch('fourth')]);
    expect(index).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(4);
  });

  // @lat: [[lat.md/view/specs#View Tests#Renders Markdown with navigable local links]]
  it('renders Markdown with navigable local links', async () => {
    const response = await fetch(
      new URL('/api/document?path=lat.md', view.url),
    );
    expect(response.status).toBe(200);
    const document = (await response.json()) as ViewDocument;

    expect(document.title).toBe('View Project');
    expect(document.frontmatter.requireCodeMention).toBe(false);
    expect(document.graphNodeIds).toEqual({ '': 'document:lat.md' });
    expect(document.html).toContain('<h1 id="view-project">View Project</h1>');
    expect(document.html).toContain('href="guide.md#details"');
    expect(document.html).not.toContain('require-code-mention');

    const links = await renderMarkdown(
      '[secure](https://example.com) [protocol](//example.org) [local](guide.md#details) [email](mailto:hi@example.com)',
      'lat.md',
    );
    expect(links.html).toContain(
      'href="https://example.com" class="external-link"',
    );
    expect(links.html).toContain('href="//example.org" class="external-link"');
    expect(links.html.match(/class="external-link-icon"/g)).toHaveLength(2);
    expect(links.html).toContain('<a href="guide.md#details">local</a>');
    expect(links.html).toContain('<a href="mailto:hi@example.com">email</a>');

    const table = await renderMarkdown(
      '| Mitigation | What Nub does |\n| --- | --- |\n| Native | Nothing. The version already ships it. |\n| Polyfill | Installs a JavaScript polyfill, guarded by a `typeof` feature detect. |',
      'guide.md',
    );
    expect(table.html).toContain('<table>');
    expect(table.html).toContain(
      '<thead><tr><th>Mitigation</th><th>What Nub does</th>',
    );
    expect(table.html).toContain(
      '<tbody><tr><td>Native</td><td>Nothing. The version already ships it.</td>',
    );
    expect(table.html).toContain('<code>typeof</code> feature detect.');
    expect(table.html).not.toContain('| --- |');

    const strikethrough = await renderMarkdown(
      'Keep ~~obsolete~~ current guidance.',
      'guide.md',
    );
    expect(strikethrough.html).toBe(
      '<p>Keep <del>obsolete</del> current guidance.</p>',
    );

    const tasks = await renderMarkdown(
      '- [x] Shipped\n- [ ] Follow up',
      'guide.md',
    );
    expect(tasks.html).toContain('<ul class="contains-task-list">');
    expect(tasks.html).toContain(
      '<input type="checkbox" checked disabled> Shipped',
    );
    expect(tasks.html).toContain(
      '<input type="checkbox" disabled> Follow up',
    );

    const autolinks = await renderMarkdown(
      'Visit https://example.com, www.example.org, or email docs@example.com.',
      'guide.md',
    );
    expect(autolinks.html).toContain(
      '<a href="https://example.com" class="external-link">',
    );
    expect(autolinks.html).toContain(
      '<a href="http://www.example.org" class="external-link">',
    );
    expect(autolinks.html).toContain(
      '<a href="mailto:docs@example.com">docs@example.com</a>',
    );
    expect(autolinks.html.match(/class="external-link-icon"/g)).toHaveLength(2);

    const safeHtml = await renderMarkdown(
      '<details open onclick="alert(1)">\n<summary>More</summary>\n\nSafe H<sub>2</sub>O.\n\n<script>alert(1)</script>\n</details>',
      'guide.md',
    );
    expect(safeHtml.html).toContain('<details open>');
    expect(safeHtml.html).toContain('<summary>More</summary>');
    expect(safeHtml.html).toContain('H<sub>2</sub>O.');
    expect(safeHtml.html).not.toContain('onclick');
    expect(safeHtml.html).not.toContain('<script>');
    expect(safeHtml.html).not.toContain('alert(1)');

    for (const [kind, label] of [
      ['note', 'Note'],
      ['tip', 'Tip'],
      ['important', 'Important'],
      ['warning', 'Warning'],
      ['caution', 'Caution'],
    ]) {
      const alert = await renderMarkdown(
        `> [!${kind.toUpperCase()}]\n> ${label} body.`,
        'guide.md',
      );
      expect(alert.html).toContain(
        `class="markdown-alert markdown-alert-${kind}"`,
      );
      expect(alert.html).toContain(
        `<p class="markdown-alert-title">${label}</p>`,
      );
      expect(alert.html).toContain(`<p>${label} body.</p>`);
      expect(alert.html).not.toContain(`[!${kind.toUpperCase()}]`);
    }

    const footnotes = await renderMarkdown(
      'Claim with a source.[^source]\n\n[^source]: Supporting detail.',
      'guide.md',
    );
    expect(footnotes.html).toContain('data-footnote-ref');
    expect(footnotes.html).toContain('<section data-footnotes');
    expect(footnotes.html).toContain('Supporting detail.');
    expect(footnotes.html).toContain('data-footnote-backref');
    expect(footnotes.html).not.toContain('href="Supporting');

    const emoji = await renderMarkdown(
      'Ship it :shipit: :+1:, leave :not-a-real-emoji: alone.',
      'guide.md',
    );
    expect(emoji.html).toContain('aria-label="+1 emoji"');
    expect(emoji.html).toContain('role="img"');
    expect(emoji.html).toContain(
      'src="https://github.githubassets.com/images/icons/emoji/shipit.png?v8"',
    );
    expect(emoji.html).toContain('alt=":shipit:" class="markdown-emoji"');
    expect(emoji.html).toContain(':not-a-real-emoji:');
    expect(emoji.html).toContain('<p>Ship it <img');

    const highlightedCode = await renderMarkdown(
      "```ts\nconst value = '<script>alert(1)</script>';\n```",
      'guide.md',
    );
    expect(highlightedCode.html).toContain(
      '<code class="language-ts hljs">',
    );
    expect(highlightedCode.html).toContain('hljs-keyword');
    expect(highlightedCode.html).toContain(
      '&#x3C;script>alert(1)&#x3C;/script>',
    );
    expect(highlightedCode.html).not.toContain('<script>');

    const unknownCode = await renderMarkdown(
      "```unknown\n<script>alert(1)</script>\n```",
      'guide.md',
    );
    expect(unknownCode.html).toContain('<code class="language-unknown">');
    expect(unknownCode.html).toContain(
      '&#x3C;script>alert(1)&#x3C;/script>',
    );
    expect(unknownCode.html).not.toContain('<script>');

    const math = await renderMarkdown(
      'Inline $E = mc^2$.\n\n$$\n\\int_0^1 x^2 \\, dx\n$$',
      'guide.md',
    );
    expect(math.html).toContain('<span class="katex">');
    expect(math.html).toContain('<span class="katex-display">');
    expect(math.html).toContain('<math');
    expect(math.html).not.toContain('language-math');

    const fencedMath = await renderMarkdown(
      '```math\n\\sum_{n=1}^{\\infty} 2^{-n} = 1\n```',
      'guide.md',
    );
    expect(fencedMath.html).toContain('<span class="katex-display">');
    expect(fencedMath.html).not.toContain('language-math');

    const mermaid = await renderMarkdown(
      '```mermaid\ngraph TD;\n  A-->B;\n```',
      'guide.md',
    );
    expect(mermaid.html).toContain(
      '<pre class="markdown-diagram-source markdown-mermaid-source">',
    );
    expect(mermaid.html).toContain('<code class="language-mermaid">');
    expect(mermaid.html).toContain('graph TD;');
    expect(mermaid.html).not.toContain('hljs');

    const geoJson = await renderMarkdown(
      '```geojson\n{"type":"Point","coordinates":[-122.4,37.8]}\n```',
      'guide.md',
    );
    expect(geoJson.html).toContain(
      '<pre class="markdown-diagram-source markdown-geojson-source">',
    );
    expect(geoJson.html).toContain('<code class="language-geojson">');
    expect(geoJson.html).not.toContain('hljs');
    expect(
      parseGeoJson('{"type":"Point","coordinates":[-122.4,37.8]}'),
    ).toEqual({ type: 'Point', coordinates: [-122.4, 37.8] });

    const topoJson = await renderMarkdown(
      '```topojson\n{"type":"Topology","objects":{},"arcs":[]}\n```',
      'guide.md',
    );
    expect(topoJson.html).toContain(
      '<pre class="markdown-diagram-source markdown-topojson-source">',
    );
    expect(topoJson.html).toContain('<code class="language-topojson">');
    expect(topoJson.html).not.toContain('hljs');
    const topojsonClient = await import('topojson-client');
    expect(
      parseTopoJson(
        '{"type":"Topology","objects":{"place":{"type":"Point","coordinates":[1,2]}},"arcs":[]}',
        topojsonClient,
      ),
    ).toMatchObject({
      type: 'FeatureCollection',
      features: [{ geometry: { type: 'Point', coordinates: [1, 2] } }],
    });

    const stlSource =
      'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle';
    const stl = await renderMarkdown(
      `\`\`\`stl\n${stlSource}\n\`\`\``,
      'guide.md',
    );
    expect(stl.html).toContain(
      '<pre class="markdown-diagram-source markdown-stl-source">',
    );
    expect(stl.html).toContain('<code class="language-stl">');
    expect(stl.html).not.toContain('hljs');
    const { STLLoader } = await import(
      'three/addons/loaders/STLLoader.js'
    );
    const geometry = parseStl(stlSource, STLLoader);
    expect(geometry.getAttribute('position').count).toBe(3);
    geometry.dispose();
    expect(() => parseStl('not an ASCII STL model', STLLoader)).toThrow(
      'expected an ASCII STL solid with facets',
    );

    const styles = readFileSync(
      join(import.meta.dirname, '..', 'view', 'src', 'styles.css'),
      'utf8',
    );
    expect(styles).toContain('.external-link-icon');
    expect(styles).toContain('-webkit-mask:');
    expect(styles.match(/\.markdown a\s*\{([^}]*)\}/)?.[1]).toContain(
      'text-decoration-line: underline;',
    );
    expect(styles.match(/\.markdown table\s*\{([^}]*)\}/)?.[1]).toContain(
      'overflow-x: auto;',
    );
    expect(styles).toContain("input[type='checkbox']");
    expect(styles).toContain('.markdown details');
    expect(styles).toContain('.markdown .markdown-alert-caution');
    expect(styles).toContain('[data-footnotes]');
    expect(styles).toContain('img.markdown-emoji');
    expect(styles).toContain('.markdown .hljs-keyword');
    expect(styles).toContain('.markdown .markdown-mermaid svg');
    expect(styles).toContain('.markdown .markdown-map-canvas');
    expect(styles).toContain('.markdown .markdown-stl-viewport');
  });

  // @lat: [[lat.md/view/specs#View Tests#Shows a local table of contents]]
  it('builds nested document navigation and tracks the active heading', async () => {
    const content =
      '# Guide\n\nOverview.\n\n## Features\n\nDetails.\n\n### `strict`\n\nMore details.';
    const tree = parse(content);
    const sections = parseSections('guide.md', content, undefined, tree);
    expect(
      buildViewTableOfContents(sections, tree, {
        errors: [
          {
            anchor: 'user-content-markdown-error-11',
            line: 11,
            marker: 'line',
            message: 'Invalid strict details',
            target: '',
          },
        ],
        gitTree: buildGitDiffTree(
          '# Guide\n\nOverview.\n\n## Features\n\nOld details.\n\n### `strict`\n\nMore details.',
          content,
          tree,
        ),
      }),
    ).toEqual([
      {
        id: 'guide',
        title: 'Guide',
        depth: 1,
        errorCount: 0,
        hasGitChanges: false,
      },
      {
        id: 'features',
        title: 'Features',
        depth: 2,
        errorCount: 0,
        hasGitChanges: true,
      },
      {
        id: 'strict',
        title: 'strict',
        depth: 3,
        errorCount: 1,
        hasGitChanges: false,
      },
    ]);
    expect(
      [1, 2, 3].map((depth) => documentTocIndentationDepth(depth, 2)),
    ).toEqual([0, 0, 1]);
    expect(
      activeDocumentTocId(
        ['features', 'strict'],
        new Map([
          ['features', -120],
          ['strict', 24],
        ]),
      ),
    ).toBe('strict');

    const shortFinalHeadings = [
      ['first', 680],
      ['second', 760],
      ['third', 840],
      ['fourth', 920],
    ] as const;
    const ids = shortFinalHeadings.map(([id]) => id);
    const activeAt = (scrollTop: number) => {
      const threshold = documentTocActivationLine({
        scrollTop,
        viewportHeight: 400,
        scrollHeight: 1000,
      });
      return activeDocumentTocId(
        ids,
        new Map(
          shortFinalHeadings.map(([id, documentTop]) => [
            id,
            documentTop - scrollTop,
          ]),
        ),
        threshold,
      );
    };

    expect([450, 500, 550, 600].map(activeAt)).toEqual([
      'first',
      'second',
      'third',
      'fourth',
    ]);
    expect(
      documentTocActivationLine({
        scrollTop: 0,
        viewportHeight: 400,
        scrollHeight: 500,
      }),
    ).toBe(96);
    expect(
      centeredDocumentTocScrollTop({
        containerHeight: 200,
        contentHeight: 600,
        itemHeight: 20,
        itemTop: 300,
      }),
    ).toBe(210);
    expect(
      centeredDocumentTocScrollTop({
        containerHeight: 200,
        contentHeight: 600,
        itemHeight: 20,
        itemTop: 580,
      }),
    ).toBe(400);

    const response = await fetch(
      new URL('/api/document?path=guide.md', view.url),
    );
    const document = (await response.json()) as ViewDocument;
    expect(document.tableOfContents).toEqual([
      {
        id: 'guide',
        title: 'Guide',
        depth: 1,
        errorCount: 0,
        hasGitChanges: false,
      },
      {
        id: 'details',
        title: 'Details',
        depth: 2,
        errorCount: 0,
        hasGitChanges: false,
      },
    ]);
  });

  // @lat: [[lat.md/view/specs#View Tests#Adapts navigation to mobile screens]]
  it('keeps mobile navigation accessible without compressing desktop rails', () => {
    const app = readFileSync(
      join(import.meta.dirname, '..', 'view', 'src', 'App.tsx'),
      'utf8',
    );
    const styles = readFileSync(
      join(import.meta.dirname, '..', 'view', 'src', 'styles.css'),
      'utf8',
    );

    expect(app).toContain('aria-controls="mobile-file-navigation"');
    expect(app).toContain("body.classList.add('mobile-navigation-open')");
    expect(styles).toContain('@media (width < 64rem)');
    expect(styles).toContain(
      ".sidebar[data-mobile-navigation-open='true'] nav",
    );
    expect(styles).toContain(".document-toc[data-expanded='true']");
    expect(app.indexOf('<DocumentToc')).toBeLessThan(
      app.indexOf('<div className="document-column">'),
    );
    expect(styles).not.toContain('order: -1');
    expect(styles).toContain('min-height: 44px');
    expect(styles).toMatch(
      /@media \(max-width: 1340px\)[\s\S]*?\.document-layout \{[\s\S]*?align-items: stretch;/,
    );
    expect(styles).toMatch(
      /@media \(min-width: 64rem\) and \(max-width: 1340px\)[\s\S]*?grid-template-areas:[\s\S]*?'metadata toc'[\s\S]*?'document document'/,
    );
    expect(styles).toMatch(
      /@media \(min-width: 64rem\) and \(max-width: 1340px\)[\s\S]*?\.sidebar-header \{[\s\S]*?min-height: 42px;[\s\S]*?\.document-toc-toggle \{[\s\S]*?min-height: 42px;/,
    );
    expect(styles).toMatch(
      /@media \(min-width: 64rem\) and \(max-width: 1340px\)[\s\S]*?\.document-toc-list \{[\s\S]*?position: absolute;[\s\S]*?top: 100%;/,
    );
    expect(styles).toMatch(
      /@media \(min-width: 64rem\) and \(max-width: 1340px\)[\s\S]*?\.document-toc \{[^}]*position: relative;[^}]*top: 0;/,
    );
    expect(styles).toMatch(
      /@media \(min-width: 64rem\) and \(max-width: 1340px\)[\s\S]*?\.document-toc-states \{[^}]*padding-right: 14px;/,
    );
    expect(styles).toMatch(
      /@media \(width < 64rem\)[\s\S]*?\.document-toc-toggle \{[\s\S]*?border-top: 0;/,
    );
  });

  // @lat: [[lat.md/view/specs#View Tests#Exposes code-mention frontmatter as metadata]]
  it('exposes code-mention frontmatter as document metadata', async () => {
    const response = await fetch(
      new URL('/api/document?path=guide.md', view.url),
    );
    const document = (await response.json()) as ViewDocument;

    expect(document.frontmatter.requireCodeMention).toBe(true);
    expect(document.graphNodeIds).toEqual({ '': 'document:guide.md' });
    expect(document.html).not.toContain('require-code-mention');
  });

  // @lat: [[lat.md/view/specs#View Tests#Resolves Markdown and source wiki links]]
  it('resolves Markdown and source wiki links', async () => {
    const response = await fetch(
      new URL('/api/document?path=lat.md', view.url),
    );
    const document = (await response.json()) as ViewDocument;

    expect(document.html).toContain(
      '<a href="/docs/guide.md">wiki navigation<span class="wiki-link-ref-count" aria-label="2 references">2</span></a>',
    );
    expect(document.html).toContain(
      '<a href="/docs/guide.md#details">wiki heading links<span class="wiki-link-ref-count" aria-label="5 references">5</span></a>',
    );
    expect(document.html).toContain(
      '<a href="/docs/guide.md#details">the same heading again<span class="wiki-link-ref-count" aria-label="5 references">5</span></a>',
    );
    expect(document.html).toContain(
      '<a href="/docs/guide.md#details" class="wiki-link-segmented"><span class="wiki-link-context">guide#</span><span class="wiki-link-leaf">Details</span><span class="wiki-link-ref-count" aria-label="5 references">5</span></a>',
    );
    expect(document.html).toContain(
      'href="/code/src/app.ts?from=lat.md%2Flat%23View+Project',
    );
    expect(document.html).toContain('line=16#run');
    expect(document.html).toContain(
      'class="wiki-link-segmented wiki-link-code"',
    );
    expect(document.html).toContain(
      'class="code-link-language code-language-ts"',
    );
    expect(document.html).toContain('class="code-link-leading"');
    expect(document.html).toContain('aria-hidden="true"');
    expect(document.html).toContain(
      '<span class="wiki-link-leaf">run</span><span class="wiki-link-ref-count" aria-label="2 references">2</span>',
    );
    expect(document.html).toContain(
      'runner</span> file<span class="wiki-link-ref-count" aria-label="3 references">3</span>',
    );
    expect(document.html).toContain(
      'same</span> file<span class="wiki-link-ref-count" aria-label="3 references">3</span>',
    );

    const styles = readFileSync(
      join(import.meta.dirname, '..', 'view', 'src', 'styles.css'),
      'utf8',
    );
    const leadingRule = styles.match(
      /^\.code-link-leading\s*\{([^}]*)\}/m,
    )?.[1];
    expect(leadingRule).toContain('display: inline-flex;');
    expect(leadingRule).toContain('align-items: baseline;');
    expect(leadingRule).toContain('white-space: nowrap;');
    expect(styles).toContain(
      'a.wiki-link-segmented .wiki-link-context,\na.wiki-link-segmented .wiki-link-leaf,',
    );
    expect(styles).toContain(
      'a.wiki-link-code:not(.wiki-link-segmented) .code-link-leading',
    );

    for (const referenceCount of [0, 1]) {
      const sparseReferences = await renderMarkdown(
        '[[orphan]]',
        'lat.md',
        async () => ({ href: '/docs/orphan.md', referenceCount }),
      );
      expect(sparseReferences.html).toBe(
        '<p><a href="/docs/orphan.md">orphan</a></p>',
      );
    }
  });

  // @lat: [[lat.md/view/specs#View Tests#Serves source definitions securely]]
  it('serves source definitions with symbol ranges', async () => {
    const response = await fetch(
      new URL('/api/source?path=src/app.ts&symbol=run', view.url),
    );
    expect(response.status).toBe(200);
    const source = (await response.json()) as ViewSourceDocument;

    expect(source.path).toBe('src/app.ts');
    expect(source.content).toContain("return 'running'");
    expect(source.highlightedHtmlLines[0]).toContain('hljs-keyword');
    expect(source.focus).toMatchObject({
      symbol: 'run',
      kind: 'function',
      startLine: 1,
      endLine: 3,
    });

    const outside = await fetch(
      new URL('/api/source?path=../../view.test.ts', view.url),
    );
    expect(outside.status).toBe(404);
    await expect(outside.json()).resolves.toEqual({
      error: 'Source document not found',
    });
  });

  // @lat: [[lat.md/view/specs#View Tests#Shows source reference context]]
  it('shows the originating paragraph and other section references', async () => {
    const url = new URL('/api/source', view.url);
    url.searchParams.set('path', 'src/app.ts');
    url.searchParams.set('symbol', 'run');
    url.searchParams.set('from', 'lat.md/lat#View Project');
    url.searchParams.set('line', '16');
    const response = await fetch(url);
    const source = (await response.json()) as ViewSourceDocument;

    expect(source.context).toEqual({
      sectionId: 'lat.md/lat#View Project',
      breadcrumbs: ['lat', 'View Project'],
      paragraph:
        'Source targets such as src/app.ts#run open their definitions; the guide explains them.',
      paragraphHtml: expect.any(String),
      url: '/docs/lat.md#view-project',
    });
    expect(source.otherReferences).toEqual([
      {
        sectionId: 'lat.md/guide#Guide#Details',
        breadcrumbs: ['guide', 'Guide', 'Details'],
        paragraph: 'The guide also references the same runner.',
        paragraphHtml: expect.any(String),
        url: '/docs/guide.md#details',
      },
    ]);
    expect(source.context?.paragraphHtml).toContain(
      'wiki-link-segmented wiki-link-code wiki-link-active',
    );
    expect(source.context?.paragraphHtml).toContain(
      'code-link-language code-language-ts',
    );
    expect(source.context?.paragraphHtml).toContain(
      'href="/docs/guide.md#details"',
    );
    expect(source.otherReferences[0].paragraphHtml).toContain(
      'wiki-link-code wiki-link-active',
    );
  });

  // @lat: [[lat.md/view/specs#View Tests#Shows section back-references]]
  it('shows Markdown and code references on every referenced section', async () => {
    const response = await fetch(
      new URL('/api/document?path=guide.md', view.url),
    );
    const document = (await response.json()) as ViewDocument;
    const details = document.backReferences.find(
      (section) => section.sectionId === 'lat.md/guide#Guide#Details',
    );

    expect(details).toBeDefined();
    expect(details?.headingId).toBe('details');
    expect(details?.references).toHaveLength(5);
    expect(details?.references.map((reference) => reference.kind)).toEqual([
      'markdown',
      'markdown',
      'markdown',
      'markdown',
      'code',
    ]);
    expect(details?.references[0]).toMatchObject({
      kind: 'markdown',
      sectionId: 'lat.md/lat#View Project',
      breadcrumbs: ['lat', 'View Project'],
      url: '/docs/lat.md#view-project',
    });
    expect(details?.references[1]).toMatchObject({
      kind: 'markdown',
      sectionId: 'lat.md/lat#View Project',
    });
    expect(details?.references[4]).toEqual({
      kind: 'code',
      path: 'src/app.ts',
      line: 5,
      snippet: expect.stringContaining('@lat: [[guide#Details]]'),
      url: '/code/src/app.ts?at=5',
    });

    const rendered = renderSectionBackReferences(
      document.html,
      document.backReferences,
    );
    expect(rendered).toContain('data-section-back-references');
    expect(rendered).toContain('<span>Refs</span>');
    expect(rendered).toContain('section-back-reference-count">5</span>');
    expect(rendered).toContain('id="section-back-references-1"');
    expect(rendered).toContain('href="/code/src/app.ts?at=5"');
    expect(rendered).toContain('wiki-link-active');

    const sourceResponse = await fetch(
      new URL('/api/source?path=src/app.ts&at=5', view.url),
    );
    const source = (await sourceResponse.json()) as ViewSourceDocument;
    expect(source.focus).toMatchObject({
      symbol: 'line 5',
      kind: 'reference',
      startLine: 5,
      endLine: 5,
    });
  });

  // @lat: [[lat.md/view/specs#View Tests#Places context within a collapsed source window]]
  it('places context before the focused lines and collapses distant code', () => {
    const focus = {
      symbol: 'run',
      kind: 'function',
      signature: 'function run() {',
      startLine: 10,
      endLine: 12,
    };
    expect(getSourceWindow(30, focus)).toEqual({
      startLine: 5,
      endLine: 17,
      hiddenAbove: 4,
      hiddenBelow: 13,
    });
    expect(getSourceWindow(30, focus, true, false)).toMatchObject({
      startLine: 1,
      hiddenAbove: 0,
    });
    expect(getSourceWindow(30, focus, false, true)).toMatchObject({
      endLine: 30,
      hiddenBelow: 0,
    });

    const rows = getSourceWindowRows(30, focus, true);
    expect(rows[0]).toEqual({
      kind: 'expand',
      count: 4,
      direction: 'above',
    });
    expect(rows[5]).toEqual({ kind: 'line', focused: false, lineNumber: 9 });
    expect(rows[6]).toEqual({ kind: 'context' });
    expect(rows[7]).toEqual({ kind: 'line', focused: true, lineNumber: 10 });
    expect(rows.at(-1)).toEqual({
      kind: 'expand',
      count: 13,
      direction: 'below',
    });

    let anchorTop = 180;
    const scrollBy = vi.fn();
    const viewport = {
      getElementById: vi.fn(() => ({
        getBoundingClientRect: () => ({ top: anchorTop }),
      })),
      scrollBy,
    };
    const anchor = captureScrollAnchor('source-line-5', viewport);
    anchorTop = 420;
    restoreScrollAnchor(anchor!, viewport);
    expect(scrollBy).toHaveBeenCalledWith({
      top: 240,
      behavior: 'instant',
    });
  });

  // @lat: [[lat.md/view/specs#View Tests#Highlights source syntax safely]]
  it('highlights source syntax without emitting executable markup', () => {
    const lines = highlightSource(
      'src/example.ts',
      "const value = '<script>alert(1)</script>';\n/* first\nsecond */",
    );
    const html = lines.join('\n');

    expect(html).toContain('hljs-keyword');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(lines[1]).toContain('hljs-comment');
    expect(lines[2]).toContain('hljs-comment');
  });

  // @lat: [[lat.md/view/specs#View Tests#Builds a nested file tree]]
  it('builds a nested file tree', () => {
    const tree = buildFileTree([
      'lat.md',
      'guides/setup.md',
      'guides/guides.md',
      'guides/api.md',
      'api.md',
      'chapter10.md',
      'Chapter2.md',
    ]);

    expect(tree).toEqual([
      { kind: 'file', name: 'lat.md', path: 'lat.md' },
      { kind: 'file', name: 'api.md', path: 'api.md' },
      { kind: 'file', name: 'Chapter2.md', path: 'Chapter2.md' },
      { kind: 'file', name: 'chapter10.md', path: 'chapter10.md' },
      {
        kind: 'directory',
        name: 'guides',
        path: 'guides',
        children: [
          { kind: 'file', name: 'guides.md', path: 'guides/guides.md' },
          { kind: 'file', name: 'api.md', path: 'guides/api.md' },
          { kind: 'file', name: 'setup.md', path: 'guides/setup.md' },
        ],
      },
    ]);

    const guides = tree.find((node) => node.path === 'guides');
    expect(guides?.kind).toBe('directory');
    if (guides?.kind === 'directory') {
      expect(directoryIndex(guides)?.path).toBe('guides/guides.md');
    }

    const nested = buildFileTree([
      'area/area.md',
      'area/deep/deep.md',
      'area/deep/broken.md',
    ]);
    const area = nested[0];
    expect(
      fileTreeErrorCount(area, {
        'area/area.md': 1,
        'area/deep/broken.md': 2,
      }),
    ).toBe(3);
    if (area.kind === 'directory') {
      const deep = area.children.find((node) => node.path === 'area/deep');
      expect(
        deep && fileTreeErrorCount(deep, { 'area/deep/broken.md': 2 }),
      ).toBe(2);
      expect(
        fileTreeGitStatus(area, {
          'area/deep/broken.md': 'new',
        }),
      ).toBe('new');
      expect(
        deep &&
          fileTreeGitStatus(deep, {
            'area/deep/broken.md': 'new',
            'area/deep/deep.md': 'modified',
          }),
      ).toBe('modified');
    }

    const directory = { open: false };
    expandDirectory(directory);
    expect(directory.open).toBe(true);
  });

  // @lat: [[lat.md/view/specs#View Tests#Stabilizes fragment navigation immediately]]
  it('positions fragment navigation without smooth scrolling', () => {
    const scrollIntoView = vi.fn();
    const getElementById = vi.fn(() => ({ scrollIntoView }));
    const scrollTo = vi.fn();

    scrollToDocumentLocation('#wiki%20links', {
      getElementById,
      scrollTo,
    });

    expect(getElementById).toHaveBeenCalledWith('wiki links');
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'start',
    });
    expect(scrollTo).not.toHaveBeenCalled();

    getElementById.mockClear();
    scrollIntoView.mockClear();
    scrollToDocumentLocation(
      '#guide',
      {
        getElementById,
        scrollTo,
      },
      'guide',
    );
    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'instant',
    });
    expect(getElementById).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();

    expect(viewRouteIdentity('/docs/guide.md#features')).toBe('/docs/guide.md');
    expect(viewRouteIdentity('/docs/guide.md#installation')).toBe(
      '/docs/guide.md',
    );
    expect(viewRouteIdentity('/code/parser.ts#parse')).toBe(
      '/code/parser.ts#parse',
    );
    expect(
      isSameMarkdownDocument(
        new URL('http://lat.local/docs/guide.md#features'),
        new URL('http://lat.local/docs/guide.md#installation'),
      ),
    ).toBe(true);
    expect(
      isSameMarkdownDocument(
        new URL('http://lat.local/docs/guide.md'),
        new URL('http://lat.local/docs/other.md'),
      ),
    ).toBe(false);
  });

  // @lat: [[lat.md/view/specs#View Tests#Restores history scroll positions]]
  it('preserves scroll positions in navigation history state', () => {
    const state = historyStateWithScroll(
      searchHistoryState('/docs/guide.md#details'),
      { left: 12, top: 480 },
    );

    expect(searchReturnTo(state)).toBe('/docs/guide.md#details');
    expect(historyScrollPosition(state)).toEqual({ left: 12, top: 480 });
    expect(historyScrollPosition({ latScrollPosition: { top: '480' } })).toBe(
      null,
    );
  });

  // @lat: [[lat.md/view/specs#View Tests#Rejects files outside the Markdown vault]]
  it('rejects files outside the Markdown vault', async () => {
    const outside = await fetch(
      new URL('/api/document?path=../package.json', view.url),
    );
    expect(outside.status).toBe(404);
    await expect(outside.json()).resolves.toEqual({
      error: 'Markdown document not found',
    });
  });

  // @lat: [[lat.md/view/specs#View Tests#Launches the browser after the server starts]]
  it('launches the browser after the server starts', async () => {
    const openBrowser = vi.fn(async () => {});
    let started: ViewServer | undefined;

    const result = await uiCommand(testContext(), {
      clientDir,
      logoText: 'Project Atlas',
      openBrowser,
      onStarted(server) {
        started = server;
      },
    });

    expect(started).toBeDefined();
    expect(Number(new URL(started!.url).port)).toBeGreaterThanOrEqual(
      DEFAULT_VIEW_PORT,
    );
    expect(new URL(started!.url).port).not.toBe(new URL(view.url).port);
    expect(openBrowser).toHaveBeenCalledWith(started!.url);
    expect(result.output).toBe(
      `Viewing lat.md at ${started!.url}\n` +
        'Note: you can use `lat ui build` to build a static version of the UI',
    );
    const index = (await (
      await fetch(new URL('/api/index', started!.url))
    ).json()) as ViewIndex;
    expect(index.logoText).toBe('Project Atlas');

    const occupiedPort = Number(new URL(view.url).port);
    const conflict = await uiCommand(testContext(), {
      clientDir,
      openBrowser,
      port: occupiedPort,
    });
    expect(conflict).toEqual({
      isError: true,
      output: `Port ${occupiedPort} is already in use. Choose another with --port <number>.`,
    });
    expect(openBrowser).toHaveBeenCalledTimes(1);
    await started!.close();
  });
});

describe('lat ui validation diagnostics', () => {
  // @lat: [[lat.md/view/specs#View Tests#Shows live validation errors]]
  it('marks invalid files and refreshes their clickable diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lat-view-errors-'));
    const errorsLatDir = join(root, 'lat.md');
    const rootFile = join(errorsLatDir, 'lat.md');
    mkdirSync(errorsLatDir);
    writeFileSync(
      rootFile,
      '# Broken\n\nA valid overview.\n\nA [missing file](missing.md).\n\nA [[missing#Section]] reference.\n',
    );

    const errorsView = await startViewServer(
      {
        latDir: errorsLatDir,
        projectRoot: root,
        styler: plainStyler,
        mode: 'cli',
      },
      { clientDir: root, watch: false },
    );

    try {
      const initialIndex = errorsView.store.getIndex();
      expect(initialIndex.errorCounts).toEqual({ 'lat.md': 2 });

      const initial = await errorsView.store.getDocument('lat.md');
      expect(initial.errors).toHaveLength(2);
      expect(initial.html).toContain('class="markdown-error"');
      expect(initial.html).toContain('id="user-content-markdown-error-5"');
      expect(initial.html).toContain('id="user-content-markdown-error-7"');
      writeFileSync(
        rootFile,
        '# Fixed\n\nA valid overview with no broken links.\n',
      );
      await errorsView.store.refresh(['lat.md/lat.md']);
      expect(errorsView.store.getIndex().errorCounts).toEqual({});
      const fixed = await errorsView.store.getDocument('lat.md');
      expect(fixed.errors).toEqual([]);
      expect(fixed.html).not.toContain('markdown-error');

      writeFileSync(
        rootFile,
        '# Broken again\n\nA valid overview.\n\nAnother [[missing#Section]] reference.\n',
      );
      await errorsView.store.refresh(['lat.md/lat.md']);
      expect(errorsView.store.getIndex().errorCounts).toEqual({ 'lat.md': 1 });
    } finally {
      await errorsView.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('lat ui git state', () => {
  // @lat: [[lat.md/view/specs#View Tests#Shows live Git state]]
  it('refreshes file state and renders HEAD changes as inline word diffs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lat-view-git-'));
    const gitLatDir = join(root, 'lat.md');
    const rootFile = join(gitLatDir, 'lat.md');
    const newFile = join(gitLatDir, 'fresh.md');
    const baseline = '# Notes\n\nThe old paragraph has blue words.\n';
    mkdirSync(gitLatDir);
    writeFileSync(rootFile, baseline);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'lat-ui@example.test'], {
      cwd: root,
    });
    execFileSync('git', ['config', 'user.name', 'lat ui test'], { cwd: root });
    execFileSync('git', ['add', 'lat.md'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: root });

    const gitView = await startViewServer(
      {
        latDir: gitLatDir,
        projectRoot: root,
        styler: plainStyler,
        mode: 'cli',
      },
      { clientDir: root, gitPollMs: 20, watch: false },
    );

    try {
      expect(gitView.store.getIndex().git).toEqual({ files: {} });
      writeFileSync(
        rootFile,
        '# Notes\n\nThe new paragraph has green words and [[missing#Target]].\n',
      );
      writeFileSync(newFile, '# Fresh\n\nA fresh document.\n');
      execFileSync('git', ['add', 'lat.md/lat.md'], { cwd: root });
      await gitView.store.refresh(['lat.md/lat.md', 'lat.md/fresh.md']);

      expect(gitView.store.getIndex()).toMatchObject({
        errorCounts: { 'lat.md': 1 },
        git: {
          files: {
            'fresh.md': 'new',
            'lat.md': 'modified',
          },
        },
      });
      const modified = await gitView.store.getDocument('lat.md');
      expect(modified.html).not.toContain('git-added');
      expect(modified.gitHtml).toContain('class="git-removed"');
      expect(modified.gitHtml).toContain('class="git-added"');
      expect(modified.gitHtml).toContain('old');
      expect(modified.gitHtml).toContain('new');

      const added = await gitView.store.getDocument('fresh.md');
      expect(added.gitHtml).toContain('class="git-added"');

      const dirtyGeneration = gitView.store.snapshot.generation;
      execFileSync('git', ['add', 'lat.md'], { cwd: root });
      execFileSync('git', ['commit', '--quiet', '-m', 'updated'], {
        cwd: root,
      });
      await vi.waitFor(
        () => {
          expect(gitView.store.getIndex().git).toEqual({ files: {} });
        },
        { interval: 10, timeout: 1_000 },
      );
      expect(gitView.store.snapshot.generation).toBe(dirtyGeneration + 1);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(gitView.store.snapshot.generation).toBe(dirtyGeneration + 1);
    } finally {
      await gitView.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses word diffs only for blocks with enough overlap', async () => {
    const current = '# Title\n\nThe [new link](guide.md) stays clickable.\n';
    const tree = buildGitDiffTree(
      '# Title\n\nThe [old link](guide.md) stays clickable.\n',
      current,
    );
    const rendered = await renderMarkdown(
      current,
      'lat.md',
      undefined,
      {},
      tree,
    );

    expect(rendered.html).toContain(
      '<del class="git-removed"><a href="guide.md">old</a></del>',
    );
    expect(rendered.html).toContain(
      '<ins class="git-added"><a href="guide.md">new</a></ins>',
    );
    expect(rendered.html).toContain('href="guide.md"');

    const replacement =
      'Polling also detects commits without filesystem events, clearing stale diff markers while unchanged Git snapshots remain silent.';
    const replaced = await renderMarkdown(
      replacement,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(
        'The top Git toggle hides or reveals both sidebar markers and inline diffs without changing the underlying files.',
        replacement,
      ),
    );
    expect(replaced.html).toContain('<p class="git-removed">The top Git');
    expect(replaced.html).toContain(
      '<p class="git-added">Polling also detects commits',
    );
    expect(replaced.html).not.toContain('<del class="git-removed">');

    const moderateReplacement =
      'The server prefers port 4242 and launches the default browser.';
    const moderate = await renderMarkdown(
      moderateReplacement,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(
        'The server starts on port 4242 and opens the browser.',
        moderateReplacement,
      ),
    );
    expect(moderate.html).toContain(
      '<p class="git-removed">The server starts on port 4242',
    );
    expect(moderate.html).toContain(
      '<p class="git-added">The server prefers port 4242',
    );

    const portDescription =
      '`lat ui` prefers loopback port 4242, advances when an implicit default is occupied, and starts listening before passing the final URL to the platform browser launcher.';
    const portRewrite = await renderMarkdown(
      portDescription,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(
        '`lat ui` starts listening before passing the loopback URL to the platform browser launcher, then reports the URL and points users to `lat ui build` for static export.',
        portDescription,
      ),
    );
    expect(portRewrite.html).toContain(
      '<p class="git-removed"><code>lat ui</code> starts listening',
    );
    expect(portRewrite.html).toContain(
      '<p class="git-added"><code>lat ui</code> prefers loopback port 4242',
    );
  });

  it('marks every rendered block in a new Markdown file as added', async () => {
    const current = [
      '# New file',
      '',
      '## Section',
      '',
      '- Unordered item',
      '',
      '1. Ordered item',
      '',
      '```text',
      'code block',
      '```',
      '',
    ].join('\n');
    const rendered = await renderMarkdown(
      current,
      'fresh.md',
      undefined,
      {},
      buildGitDiffTree('', current),
    );

    expect(rendered.html).toContain('<h2 class="git-added"');
    expect(rendered.html).toContain('<ul class="git-added">');
    expect(rendered.html).toContain('<ol class="git-added"');
    expect(rendered.html).toContain(
      '<code class="language-text git-added">code block',
    );
  });
});

describe('lat ui live project index', () => {
  // @lat: [[lat.md/view/specs#View Tests#Updates long-running views incrementally]]
  it('updates cached files, backlinks, code refs, and clients incrementally', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lat-view-live-'));
    const liveLatDir = join(root, 'lat.md');
    const nestedDir = join(liveLatDir, 'nested');
    const sourceDir = join(root, 'src');
    mkdirSync(liveLatDir);
    mkdirSync(sourceDir);
    writeFileSync(
      join(liveLatDir, 'lat.md'),
      '# Live\n\nThe root links to [the target](target.md#target).\n',
    );
    writeFileSync(
      join(liveLatDir, 'target.md'),
      '# Target\n\nThe target section.\n',
    );
    writeFileSync(
      join(sourceDir, 'app.ts'),
      ['// @', 'lat: [[target#Target]]\nexport const value = 1;\n'].join(''),
    );

    const live = await startViewServer(
      {
        latDir: liveLatDir,
        projectRoot: root,
        styler: plainStyler,
        mode: 'cli',
      },
      { clientDir: root, watch: false },
    );
    const events = await fetch(new URL('/api/events', live.url));
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();

    try {
      const ready = await reader.read();
      expect(decoder.decode(ready.value)).toContain('event: ready');

      const initial = (await (
        await fetch(new URL('/api/document?path=target.md', live.url))
      ).json()) as ViewDocument;
      expect(initial.backReferences[0].references).toHaveLength(2);
      expect(initial.backReferences[0].references[0].kind).toBe('markdown');
      const unchangedTarget = live.store.snapshot.files.get('target.md');

      mkdirSync(nestedDir);
      writeFileSync(
        join(nestedDir, 'target.md'),
        '# Target\n\nA second target makes the short code ref ambiguous.\n',
      );
      await live.store.refresh(['lat.md/nested']);

      const changed = await reader.read();
      expect(decoder.decode(changed.value)).toContain('event: change');
      expect(live.store.snapshot.files.get('target.md')).toBe(unchangedTarget);
      expect(live.store.getIndex().files).toEqual([
        'lat.md',
        'nested/target.md',
        'target.md',
      ]);
      const ambiguous = (await (
        await fetch(new URL('/api/document?path=target.md', live.url))
      ).json()) as ViewDocument;
      expect(ambiguous.backReferences[0].references).toHaveLength(1);

      rmSync(join(nestedDir, 'target.md'));
      await live.store.refresh(['lat.md/nested/target.md']);
      writeFileSync(
        join(liveLatDir, 'lat.md'),
        '# Live\n\nThe root links to [the target](target.md#target).\n\nA second [target link](target.md#target) lives in another paragraph.\n',
      );
      await live.store.refresh(['lat.md/lat.md']);
      const restored = (await (
        await fetch(new URL('/api/document?path=target.md', live.url))
      ).json()) as ViewDocument;
      expect(restored.backReferences[0].references).toHaveLength(3);

      writeFileSync(join(sourceDir, 'app.ts'), 'export const value = 2;\n');
      await live.store.refresh(['src/app.ts']);
      const withoutCode = (await (
        await fetch(new URL('/api/document?path=target.md', live.url))
      ).json()) as ViewDocument;
      expect(withoutCode.backReferences[0].references).toHaveLength(2);
    } finally {
      await reader.cancel();
      await live.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
