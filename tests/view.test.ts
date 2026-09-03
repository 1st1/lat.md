import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import express from 'express';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { plainStyler, type CmdContext } from '../src/context.js';
import { setRepoEmbedding } from '../src/config.js';
import { uiCommand } from '../src/cli/ui.js';
import { uiBuildCommand } from '../src/cli/ui-build.js';
import { uiBuildServerCommand } from '../src/cli/ui-build-server.js';
import { runIndex as buildSearchIndex } from '../src/cli/search.js';
import { analyzeMarkdownFile } from '../src/markdown-analysis.js';
import {
  DEFAULT_VIEW_PORT,
  startViewServer,
  type ViewServer,
} from '../src/view/server.js';
import {
  buildStaticView,
  moveViewBuildOutput,
  normalizeStaticViewBasePath,
  staticViewUrl,
} from '../src/view/static-build.js';
import { buildServerView } from '../src/view/server-build.js';
import {
  createServerViewApp,
  type ServerViewManifest,
} from '../src/view/server-deployment.js';
import { analyzeMarkdownProject } from '../src/project-analysis.js';
import type {
  ViewStaticBootstrap,
  ViewStaticManifest,
  ViewStaticSourceFile,
  ViewStaticSourceView,
} from '../src/view/static-protocol.js';
import { buildGitDiffTree } from '../src/view/git-diff.js';
import { renderMarkdown as renderMarkdownTree } from '../src/view/markdown.js';
import type {
  ViewDocument,
  ViewDocumentEditResponse,
  ViewDocumentSource,
  ViewDocumentTree,
  ViewGraph,
  ViewIndex,
  ViewSearchResponse,
  ViewSectionCommandOutput,
  ViewSourceDocument,
} from '../src/view/protocol.js';
import { MarkdownContent } from '../view/src/MarkdownContent.js';
import { SourceView } from '../view/src/SourceView.js';
import { documentTreeToHtml } from './document-tree.js';
import { createViewSearch } from '../src/view/search.js';
import { createPreindexedViewSearch } from '../src/view/preindexed-search.js';
import { buildViewTableOfContents } from '../src/view/table-of-contents.js';
import {
  activeDocumentTocId,
  centeredDocumentTocScrollTop,
  documentTocActivationLine,
  documentTocIndentationDepth,
} from '../view/src/document-toc.js';
import {
  buildExternalFileTree,
  buildFileTree,
  directoryIndex,
  expandDirectory,
  fileTreeErrorCount,
  fileTreeGitStatus,
  type FileTreeNode,
} from '../view/src/file-tree.js';
import {
  documentPath,
  documentUrl,
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
  isSameRenderedDocument,
  externalUrl,
  rawDocumentUrl,
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
  geoJsonBounds,
  OPENFREEMAP_STYLE_URL,
  parseGeoJson,
  parseStl,
  parseTopoJson,
  recoverableLazyImport,
} from '../view/src/markdown-rich-fences.js';
import {
  copySectionId,
  navigateAndCopySectionLink,
  sectionOutputRequestUrl,
} from '../view/src/section-back-references.js';
import {
  captureScrollAnchor,
  restoreScrollAnchor,
} from '../view/src/scroll-anchor.js';
import {
  getSourceWindow,
  getSourceWindowRows,
} from '../view/src/source-window.js';
import {
  staticViewAssetUrl,
  staticViewBasePath,
  staticViewRoute,
  staticViewSearchApi,
  viewPathname,
} from '../view/src/static-mode.js';
import viewViteConfig from '../view/vite.config.js';
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

async function renderMarkdown(
  ...args: Parameters<typeof renderMarkdownTree>
): Promise<Awaited<ReturnType<typeof renderMarkdownTree>> & { html: string }> {
  const rendered = await renderMarkdownTree(...args);
  return { ...rendered, html: documentTreeToHtml(rendered.tree) };
}

function viewDocumentHtml(document: ViewDocument): string {
  return documentTreeToHtml(document.tree);
}

function viewDocumentGitHtml(document: ViewDocument): string | null {
  return document.gitTree ? documentTreeToHtml(document.gitTree) : null;
}

function paragraphTreeHtml(
  reference: { paragraphTree: ViewDocumentTree } | null | undefined,
): string {
  return reference ? documentTreeToHtml(reference.paragraphTree) : '';
}

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
      '<!doctype html><html><head><script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css"></head><body><main>lat ui shell</main></body></html>',
    );
    writeFileSync(join(clientDir, 'assets', 'app.js'), 'export {};');
    writeFileSync(join(clientDir, 'assets', 'app.css'), 'main {}');
    writeFileSync(
      join(clientDir, 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    view = await startViewServer(testContext(), {
      clientDir,
      git: false,
      search: createViewSearch(latDir, { runIndex, runSearch }),
    });
  });

  afterAll(async () => {
    await view.close();
    rmSync(clientDir, { recursive: true, force: true });
    rmSync(join(latDir, '.cache'), { recursive: true, force: true });
  });

  // @lat: [[lat.md/view/specs#View Tests#Serves the document index and browser shell]]
  it('serves the document index and browser shell', async () => {
    const indexResponse = await fetch(new URL('/api/index', view.url));
    expect(indexResponse.status).toBe(200);
    expect((await indexResponse.json()) as ViewIndex).toEqual({
      files: ['guide.md', 'lat.md'],
      externalFiles: [],
      entry: 'lat.md',
      errorCounts: {},
      git: null,
      logoText: 'lat.md',
    });

    const rootResponse = await fetch(view.url, { redirect: 'manual' });
    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.get('location')).toBe('/docs/lat');

    const shellResponse = await fetch(new URL('/docs/guide', view.url));
    expect(shellResponse.status).toBe(200);
    expect(shellResponse.headers.get('x-powered-by')).toBeNull();
    const shell = await shellResponse.text();
    expect(shell).toContain('lat ui shell');
    expect(shell).toContain('src="/assets/app.js"');
    expect(shell).toContain('href="/assets/app.css"');
    expect(shell).not.toContain('./assets/');
    const contentSecurityPolicy = shellResponse.headers.get(
      'content-security-policy',
    );
    expect(contentSecurityPolicy).toContain(
      "connect-src 'self' https://tiles.openfreemap.org",
    );
    expect(contentSecurityPolicy).toContain("font-src 'self' data:");
    expect(contentSecurityPolicy).toContain(
      "img-src 'self' data: https://github.com https://github.githubassets.com https://img.shields.io",
    );

    const rawResponse = await fetch(new URL('/docs/guide.md', view.url));
    expect(rawResponse.status).toBe(200);
    expect(rawResponse.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(await rawResponse.text()).toBe(
      readFileSync(join(latDir, 'guide.md'), 'utf8'),
    );

    const rawHeadResponse = await fetch(new URL('/docs/guide.md', view.url), {
      method: 'HEAD',
    });
    expect(rawHeadResponse.status).toBe(200);
    expect(rawHeadResponse.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(await rawHeadResponse.text()).toBe('');

    const missingRawResponse = await fetch(
      new URL('/docs/missing.md', view.url),
    );
    expect(missingRawResponse.status).toBe(404);
    const escapingRawResponse = await fetch(
      new URL('/docs/..%2F..%2FREADME.md', view.url),
    );
    expect(escapingRawResponse.status).toBe(404);

    const resourceResponse = await fetch(
      new URL('/resources/media/project.svg', view.url),
    );
    expect(resourceResponse.status).toBe(200);
    expect(resourceResponse.headers.get('content-type')).toBe('image/svg+xml');
    expect(await resourceResponse.text()).toContain('<circle');
    const missingResourceResponse = await fetch(
      new URL('/resources/media/missing.svg', view.url),
    );
    expect(missingResourceResponse.status).toBe(404);
    const escapingResourceResponse = await fetch(
      new URL('/resources/..%2F..%2Fpackage.json', view.url),
    );
    expect(escapingResourceResponse.status).toBe(404);

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
    expect(app).toContain("import latLogoUrl from './logo.svg?url'");
    expect(app).toContain('brandText === DEFAULT_VIEW_LOGO_TEXT');
    expect(app).toContain('<BrandText text={brandText} />');
    expect(app).toContain('src={staticViewAssetUrl(latLogoUrl)}');
    expect(styles).toContain('.brand-logo');
  });

  // @lat: [[lat.md/view/specs#View Tests#Builds a static deployment]]
  it('builds a static deployment without live Git or search services', async () => {
    const move = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('busy'), { code: 'EBUSY' }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('busy'), { code: 'EPERM' }),
      )
      .mockResolvedValue(undefined);
    const wait = vi.fn(async () => {});
    await moveViewBuildOutput('staging', 'output', { move, wait });
    expect(move).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);

    expect(viewViteConfig).toMatchObject({ base: './' });
    expect(normalizeStaticViewBasePath('/project')).toBe('/project/');
    expect(staticViewUrl('/docs/guide', '/project/')).toBe(
      '/project/docs/guide',
    );
    expect(staticViewUrl('/docs/guide.md', '/project/')).toBe(
      '/project/docs/guide.md',
    );
    expect(staticViewUrl('/docs/lat', '/project/', 'lat.md')).toBe('/project/');
    expect(staticViewUrl('/graph?node=document%3Alat.md', '/project/')).toBe(
      '/project/graph/?node=document%3Alat.md',
    );
    expect(staticViewUrl('/resources/media/project.svg', '/project/')).toBe(
      '/project/resources/media/project.svg',
    );
    expect(staticViewAssetUrl('/assets/logo.svg', '/project/')).toBe(
      '/project/assets/logo.svg',
    );
    expect(staticViewAssetUrl('/assets/logo.svg', '/')).toBe(
      '/assets/logo.svg',
    );
    expect(staticViewAssetUrl('/logo.svg', '/project/')).toBe('/logo.svg');
    const staticConfig = encodeURIComponent(
      JSON.stringify({
        basePath: '/project/',
        entry: 'lat.md',
        searchApi: '/project/api/search',
      }),
    );
    vi.stubGlobal('document', {
      querySelector: () => ({ content: staticConfig }),
    });
    try {
      expect(staticViewBasePath()).toBe('/project/');
      expect(staticViewSearchApi()).toBe('/project/api/search');
      expect(viewPathname('/project/index.html')).toBe('/docs/lat');
      expect(viewPathname('/project/')).toBe('/docs/lat');
      expect(staticViewRoute('docs/lat')).toBe('/project/');
    } finally {
      vi.unstubAllGlobals();
    }
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
        externalFiles: [],
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
      expect(sourceFile.highlightedLines.length).toBeGreaterThan(0);
      expect(sourceView).toHaveProperty('focus');
      expect(sourceView).not.toHaveProperty('content');
      expect({ ...sourceFile, ...sourceView }).toHaveProperty(
        'otherReferences',
      );

      const document = JSON.parse(
        readFileSync(join(payloadDir, manifest.documents['lat.md']), 'utf8'),
      ) as ViewDocument;
      const documentContent = readFileSync(
        join(payloadDir, manifest.documents['lat.md']),
        'utf8',
      );
      expect(manifest.documents['lat.md']).toBe(
        `data/documents/${createHash('sha256').update(documentContent).digest('hex').slice(0, 20)}.json`,
      );
      expect(viewDocumentGitHtml(document)).toBeNull();
      expect(viewDocumentHtml(document)).toContain(
        'href="/project/docs/guide#details"',
      );
      expect(viewDocumentHtml(document)).toContain(
        'href="/project/code/src/app.ts/?from=',
      );
      expect(viewDocumentHtml(document)).toContain(
        'src="/project/resources/media/project.svg"',
      );

      const graph = JSON.parse(
        readFileSync(join(payloadDir, manifest.graph), 'utf8'),
      ) as ViewGraph;
      expect(graph.nodes.every((node) => node.gitStatus === undefined)).toBe(
        true,
      );
      expect(graph.nodes.map((node) => node.url)).toContain('/project/');
      expect(graph.nodes.some((node) => node.kind === 'source')).toBe(true);

      expect(existsSync(join(payloadDir, 'docs', 'lat', 'index.html'))).toBe(
        true,
      );
      expect(readFileSync(join(payloadDir, 'docs', 'lat.md'), 'utf8')).toBe(
        readFileSync(join(staticContext.latDir, 'lat.md'), 'utf8'),
      );
      expect(
        existsSync(join(payloadDir, 'code', 'src', 'app.ts', 'index.html')),
      ).toBe(true);
      expect(existsSync(join(payloadDir, 'data', 'source-files'))).toBe(true);
      expect(existsSync(join(payloadDir, 'data', 'source-views'))).toBe(true);
      expect(existsSync(join(payloadDir, 'graph', 'index.html'))).toBe(true);
      expect(existsSync(join(payloadDir, 'search', 'index.html'))).toBe(false);
      expect(existsSync(join(payloadDir, 'assets', 'app.js'))).toBe(true);
      expect(
        readFileSync(
          join(payloadDir, 'resources', 'media', 'project.svg'),
          'utf8',
        ),
      ).toContain('<circle');
      expect(existsSync(join(outputDir, 'assets'))).toBe(false);
      expect(existsSync(join(outputDir, 'data'))).toBe(false);

      const shell = readFileSync(join(payloadDir, 'index.html'), 'utf8');
      expect(shell).toContain('/project/assets/app.js');
      expect(shell).toContain('/project/assets/app.css');
      expect(shell).not.toContain('./assets/');
      expect(shell).toContain('meta name="lat-static-view"');
      const bootstrapMatch = shell.match(
        /<script id="lat-static-bootstrap" type="application\/json">([^<]+)<\/script>/,
      );
      expect(bootstrapMatch).not.toBeNull();
      const bootstrap = JSON.parse(bootstrapMatch![1]) as ViewStaticBootstrap;
      expect(bootstrap.manifest).toEqual(manifest);
      expect(bootstrap.responses['/api/document?path=lat.md']).toEqual(
        document,
      );
      expect(shell).toContain(
        encodeURIComponent(
          JSON.stringify({ basePath: '/project/', entry: 'lat.md' }),
        ),
      );
      expect(shell).not.toContain('globalThis.__LAT_STATIC_VIEW__');
      const redirect = readFileSync(join(outputDir, 'index.html'), 'utf8');
      expect(redirect).toContain('/project/');
      expect(redirect).toContain('meta name="lat-redirect"');
      expect(redirect).toContain('src="/project/data/redirect.js"');
      expect(redirect).not.toContain('<script>');
      expect(readFileSync(join(payloadDir, 'index.html'), 'utf8')).not.toBe(
        redirect,
      );
      expect(
        readFileSync(join(payloadDir, 'docs', 'lat', 'index.html'), 'utf8'),
      ).toContain('/project/');
      expect(
        readFileSync(join(payloadDir, 'data', 'redirect.js'), 'utf8'),
      ).toContain('window.location.replace');

      await expect(
        uiBuildCommand(staticContext, outputDir, {
          basePath: '/project',
          clientDir,
        }),
      ).resolves.toEqual({
        output: `Static UI output already exists: ${outputDir}. Use --force to replace it.`,
        isError: true,
      });

      const preserved = join(outputDir, 'preserved.txt');
      writeFileSync(preserved, 'keep until the replacement succeeds');
      await expect(
        uiBuildCommand(staticContext, outputDir, {
          basePath: '/project',
          clientDir: join(staticProjectRoot, 'missing-client'),
          force: true,
        }),
      ).resolves.toMatchObject({ isError: true });
      expect(readFileSync(preserved, 'utf8')).toBe(
        'keep until the replacement succeeds',
      );

      const forced = await uiBuildCommand(staticContext, outputDir, {
        basePath: '/project',
        clientDir,
        force: true,
      });
      expect(forced.isError).not.toBe(true);
      expect(existsSync(preserved)).toBe(false);
      expect(
        readdirSync(outputDir).some((name) => name.startsWith('.lat-')),
      ).toBe(false);

      const emptyOutput = join(staticProjectRoot, 'empty-output');
      mkdirSync(emptyOutput);
      await expect(
        uiBuildCommand(staticContext, emptyOutput, {
          basePath: '/project',
          clientDir: join(staticProjectRoot, 'missing-client'),
        }),
      ).resolves.toEqual({
        output: `Static UI output already exists: ${emptyOutput}. Use --force to replace it.`,
        isError: true,
      });
    } finally {
      rmSync(buildRoot, { recursive: true, force: true });
    }
  });

  it('uses the portable server output by default', async () => {
    const buildNode = vi.fn(async (_ctx: CmdContext, output: string) => ({
      documents: 2,
      outputDir: output,
      sources: 3,
    }));

    await expect(
      uiBuildServerCommand(testContext(), undefined, {}, { buildNode }),
    ).resolves.toEqual({
      output:
        'Built 2 documents and 3 source views for node at .lat-build/server',
    });
    expect(buildNode).toHaveBeenCalledWith(
      expect.anything(),
      '.lat-build/server',
      {},
    );
  });

  // @lat: [[lat.md/view/specs#View Tests#Builds a portable server deployment]]
  it('builds static assets with a portable Express search server', async () => {
    const buildRoot = mkdtempSync(join(tmpdir(), 'lat-ui-server-test-'));
    const serverProjectRoot = join(buildRoot, 'project');
    cpSync(projectRoot, serverProjectRoot, { recursive: true });
    const serverContext: CmdContext = {
      ...testContext(),
      projectRoot: serverProjectRoot,
      latDir: join(serverProjectRoot, 'lat.md'),
    };
    const outputDir = join(serverProjectRoot, 'server-site');
    const generatedDir = join(serverProjectRoot, 'generated');
    mkdirSync(generatedDir);
    writeFileSync(
      join(generatedDir, 'compiled.ts'),
      `${['// @lat:', '[[guide#Details]]'].join(' ')}\n`,
    );
    try {
      const result = await buildServerView(
        serverContext,
        outputDir,
        {
          basePath: '/project',
          clientDir,
          codeExcludePaths: [generatedDir],
        },
        {
          analyzeMarkdownProject,
          buildStaticView,
          getLocalVersion: () => '9.8.7',
          getLatServerVersion: () => '1.2.3',
          getPackageVersion(name) {
            return {
              '@lat.md/embed': '2.3.4',
              '@lat.md/embed-minilm-fp16': '3.4.5',
              express: '5.2.1',
            }[name]!;
          },
          async runIndex(_latDir, _progress, _project, options) {
            const cacheDir = options!.cacheDir!;
            mkdirSync(cacheDir, { recursive: true });
            writeFileSync(join(cacheDir, 'vectors.db'), 'index');
          },
        },
      );
      expect(result.outputDir).toBe(outputDir);
      expect(
        existsSync(
          join(outputDir, 'public', 'project', 'search', 'index.html'),
        ),
      ).toBe(true);
      const shell = readFileSync(
        join(outputDir, 'public', 'project', 'index.html'),
        'utf8',
      );
      expect(shell).toContain('meta name="lat-static-view"');
      expect(shell).toContain(
        encodeURIComponent(
          JSON.stringify({
            basePath: '/project/',
            entry: 'lat.md',
            searchApi: '/project/api/search',
          }),
        ),
      );
      expect(shell).not.toContain('globalThis.__LAT_STATIC_VIEW__');
      const manifest = JSON.parse(
        readFileSync(join(outputDir, 'server-data', 'server.json'), 'utf8'),
      ) as ServerViewManifest;
      expect(manifest.basePath).toBe('/project/');
      expect(manifest.sections.length).toBeGreaterThan(0);
      expect(
        manifest.sections.every((section) => !('children' in section)),
      ).toBe(true);
      expect(
        readFileSync(join(outputDir, 'server-data', 'vectors.db'), 'utf8'),
      ).toBe('index');
      expect(
        JSON.parse(readFileSync(join(outputDir, 'package.json'), 'utf8')),
      ).toMatchObject({
        scripts: { start: 'lat-ui-server app.mjs' },
        dependencies: {
          '@lat.md/embed': '2.3.4',
          '@lat.md/embed-minilm-fp16': '3.4.5',
          '@lat.md/server': '1.2.3',
          express: '5.2.1',
          'lat.md': '9.8.7',
        },
      });
      const appModule = readFileSync(join(outputDir, 'app.mjs'), 'utf8');
      expect(appModule).toContain(
        "import { createEmbedder } from '@lat.md/embed'",
      );
      expect(appModule).toContain(
        "import minilm from '@lat.md/embed-minilm-fp16'",
      );
      expect(appModule).toContain("import express from 'express'");
      expect(appModule).toContain("from 'lat.md/server'");
      expect(appModule).toContain('app: express()');
      expect(appModule).not.toContain('publicDir');
      expect(appModule).not.toContain("new URL('./public/");
      expect(appModule).toContain(
        "manifestFile: new URL('./server-data/server.json'",
      );
      expect(appModule).toContain(
        "indexFile: new URL('./server-data/vectors.db'",
      );
      expect(appModule).toContain(
        'createSearchEngine: () => createEmbedder({ model: minilm })',
      );
      expect(appModule).not.toContain('node_modules/');
      expect(appModule).not.toContain('access(');
      expect(appModule).not.toContain('void ');
      expect(existsSync(join(outputDir, 'start.mjs'))).toBe(false);
      expect(
        readdirSync(outputDir).some((name) => name.startsWith('.lat-')),
      ).toBe(false);

      const staticManifest = JSON.parse(
        readFileSync(
          join(outputDir, 'public', 'project', 'data', 'manifest.json'),
          'utf8',
        ),
      ) as ViewStaticManifest;
      const exportedSourceFiles = await Promise.all(
        Object.values(staticManifest.sources).map(async ({ file }) => {
          const source = JSON.parse(
            readFileSync(join(outputDir, 'public', 'project', file), 'utf8'),
          ) as ViewStaticSourceFile;
          return source.path;
        }),
      );
      expect(exportedSourceFiles).not.toContain('generated/compiled.ts');

      const builtSection = manifest.sections[0];
      const { documentPath, ...section } = builtSection;
      const runSearch = vi.fn(async () => [
        {
          id: section.id,
          file: section.file,
          heading: section.heading,
          content: section.firstParagraph,
          score: 0.9,
        },
      ]);
      const closeSearch = vi.fn(async () => {});
      const openSearchSession = vi.fn(async () => ({
        search: runSearch,
        close: closeSearch,
      }));
      const createSearchEngine = vi.fn(async () => ({
        name: 'local:test',
        dimensions: 1,
        embed: async () => [[0]],
      }));
      const search = await createPreindexedViewSearch(
        join(outputDir, 'server-data'),
        join(outputDir, 'runtime-cache'),
        [{ ...section, children: [] }],
        new Map([[builtSection.id.toLowerCase(), documentPath]]),
        { openSearchSession },
        createSearchEngine,
      );
      expect(openSearchSession).toHaveBeenCalledWith(
        join(outputDir, 'server-data'),
        {
          cacheDir: join(outputDir, 'runtime-cache'),
          createSearchEngine,
        },
      );
      const deployment = createServerViewApp({
        app: express(),
        manifestFile: join(outputDir, 'server-data', 'server.json'),
        indexFile: join(outputDir, 'server-data', 'vectors.db'),
        search,
      });
      const server = createServer(deployment.app);
      await new Promise<void>((resolveListen) =>
        server.listen(0, '127.0.0.1', resolveListen),
      );
      const address = server.address();
      expect(address && typeof address !== 'string').toBe(true);
      const origin = `http://127.0.0.1:${typeof address === 'string' || !address ? 0 : address.port}`;
      try {
        const rootResponse = await fetch(origin, { redirect: 'manual' });
        expect(rootResponse.status).toBe(200);
        expect(await rootResponse.text()).toContain('meta name="lat-redirect"');

        const response = await fetch(
          `${origin}/project/api/search?query=portable`,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('x-powered-by')).toBeNull();
        expect(response.headers.get('content-security-policy')).toContain(
          "default-src 'self'",
        );
        await expect(response.json()).resolves.toEqual({
          query: 'portable',
          results: [
            expect.objectContaining({
              path: documentPath,
              score: 0.9,
            }),
          ],
        });
        expect(runSearch).toHaveBeenLastCalledWith('portable', 10);
        expect(runSearch).toHaveBeenCalledTimes(1);

        const searchHead = await fetch(
          `${origin}/project/api/search?query=portable`,
          { method: 'HEAD' },
        );
        expect(searchHead.status).toBe(200);
        expect(await searchHead.text()).toBe('');
        expect(runSearch).toHaveBeenCalledTimes(2);
        expect(openSearchSession).toHaveBeenCalledTimes(1);

        const document = await fetch(`${origin}/project/`);
        expect(document.status).toBe(200);
        expect(document.headers.get('cache-control')).toBe('no-cache');
        expect(await document.text()).toContain('lat ui shell');

        const oldDocumentRoute = await fetch(`${origin}/project/docs/lat`);
        expect(oldDocumentRoute.status).toBe(200);
        expect(await oldDocumentRoute.text()).toContain(
          'meta name="lat-redirect"',
        );

        const documentData = await fetch(
          `${origin}/project/${staticManifest.documents['lat.md']}`,
        );
        expect(documentData.status).toBe(200);
        expect(documentData.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );

        const stableManifest = await fetch(
          `${origin}/project/data/manifest.json`,
        );
        expect(stableManifest.status).toBe(200);
        expect(stableManifest.headers.get('cache-control')).toBe('no-cache');
      } finally {
        await new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
        await deployment.close();
        await search.close();
        expect(closeSearch).toHaveBeenCalledTimes(1);
      }
    } finally {
      rmSync(buildRoot, { recursive: true, force: true });
    }
  });

  // @lat: [[lat.md/view/specs#View Tests#Builds a portable server deployment#Runs the generated Node artifact end to end]]
  it('runs the generated Node artifact with static assets and semantic search', async () => {
    const buildRoot = mkdtempSync(join(tmpdir(), 'lat-ui-node-e2e-'));
    const serverProjectRoot = join(buildRoot, 'project');
    const outputDir = join(serverProjectRoot, 'server-site');
    const repositoryRoot = join(import.meta.dirname, '..');
    const previousXdgConfig = process.env.XDG_CONFIG_HOME;
    cpSync(projectRoot, serverProjectRoot, { recursive: true });
    process.env.XDG_CONFIG_HOME = join(buildRoot, 'xdg');
    setRepoEmbedding(join(serverProjectRoot, 'lat.md'), 'local');

    let closeGeneratedApp: (() => Promise<void>) | undefined;
    let server: ReturnType<typeof createServer> | undefined;
    try {
      await buildServerView(
        {
          ...testContext(),
          projectRoot: serverProjectRoot,
          latDir: join(serverProjectRoot, 'lat.md'),
        },
        outputDir,
        { basePath: '/project', clientDir },
        {
          analyzeMarkdownProject,
          buildStaticView,
          getLocalVersion: () =>
            JSON.parse(
              readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
            ).version as string,
          getLatServerVersion: () =>
            JSON.parse(
              readFileSync(
                join(repositoryRoot, 'packages', 'server', 'package.json'),
                'utf8',
              ),
            ).version as string,
          getPackageVersion(name) {
            const packageDirectories: Record<string, string[]> = {
              '@lat.md/embed': ['packages', 'embed'],
              '@lat.md/embed-minilm-fp16': ['packages', 'embed-minilm-fp16'],
              express: ['node_modules', 'express'],
            };
            return JSON.parse(
              readFileSync(
                join(
                  repositoryRoot,
                  ...packageDirectories[name]!,
                  'package.json',
                ),
                'utf8',
              ),
            ).version as string;
          },
          runIndex: buildSearchIndex,
        },
      );

      const nodeModules = join(outputDir, 'node_modules');
      mkdirSync(join(nodeModules, '@lat.md'), { recursive: true });
      const linkPackage = (name: string, source: string) => {
        symlinkSync(
          realpathSync(source),
          join(nodeModules, ...name.split('/')),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      };
      linkPackage('@lat.md/embed', join(repositoryRoot, 'packages', 'embed'));
      linkPackage(
        '@lat.md/embed-minilm-fp16',
        join(repositoryRoot, 'packages', 'embed-minilm-fp16'),
      );
      linkPackage('@lat.md/server', join(repositoryRoot, 'packages', 'server'));
      linkPackage('express', join(repositoryRoot, 'node_modules', 'express'));
      linkPackage('lat.md', repositoryRoot);

      const generated = (await import(
        pathToFileURL(join(outputDir, 'app.mjs')).href
      )) as {
        default: Parameters<typeof createServer>[0];
        close: () => Promise<void>;
      };
      closeGeneratedApp = generated.close;
      server = createServer(generated.default);
      await new Promise<void>((resolveListen) =>
        server!.listen(0, '127.0.0.1', resolveListen),
      );
      const address = server.address();
      expect(address && typeof address !== 'string').toBe(true);
      const origin = `http://127.0.0.1:${typeof address === 'string' || !address ? 0 : address.port}`;

      const document = await fetch(`${origin}/project/`);
      expect(document.status).toBe(200);
      expect(await document.text()).toContain('lat ui shell');

      for (const asset of ['app.js', 'app.css']) {
        const response = await fetch(`${origin}/project/assets/${asset}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect((await response.text()).length).toBeGreaterThan(0);
      }

      const search = await fetch(
        `${origin}/project/api/search?query=${encodeURIComponent('relative Markdown heading fragments')}`,
      );
      expect(search.status).toBe(200);
      expect(search.headers.get('cache-control')).toBe('no-store');
      const payload = (await search.json()) as ViewSearchResponse;
      expect(payload.query).toBe('relative Markdown heading fragments');
      expect(payload.results.length).toBeGreaterThan(0);
      expect(payload.results).toContainEqual(
        expect.objectContaining({ path: 'guide.md' }),
      );
    } finally {
      if (server) {
        await new Promise<void>((resolveClose, reject) =>
          server!.close((error) => (error ? reject(error) : resolveClose())),
        );
      }
      await closeGeneratedApp?.();
      if (previousXdgConfig === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = previousXdgConfig;
      }
      rmSync(buildRoot, { recursive: true, force: true });
    }
  }, 60_000);

  // @lat: [[lat.md/view/specs#View Tests#Keeps build-only packages out of runtime dependencies]]
  it('keeps build-only packages out of runtime dependencies', () => {
    const repositoryRoot = join(import.meta.dirname, '..');
    const rootPackage = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const buildOnlyPackages = [
      '@codemirror/commands',
      '@codemirror/lang-markdown',
      '@codemirror/language',
      '@codemirror/merge',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/highlight',
      'katex',
      'maplibre-gl',
      'mermaid',
      'rehype-stringify',
      'three',
      'topojson-client',
    ];

    for (const packageName of buildOnlyPackages) {
      expect(rootPackage.devDependencies).toHaveProperty(packageName);
      expect(rootPackage.dependencies).not.toHaveProperty(packageName);
    }
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
    const sectionTarget = '/docs/guide#details';
    const targetedGraphUrl = graphUrl('document:guide.md', sectionTarget);
    expect(targetedGraphUrl).toBe(
      '/graph?node=document%3Aguide.md&target=%2Fdocs%2Fguide%23details',
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
      graphNodeIdForUrl(
        new URL('/external/upstream/guide#navigation', view.url),
        'document',
      ),
    ).toBe('external-document:upstream:guide');
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
      graphTargetForNode(graph, documentNode!, '/docs/lat', view.url),
    ).toBe(documentNode!.url);
    const sameDocumentLink = graphInspectorLinkUrl(
      '#details',
      '/docs/guide',
      view.url,
    );
    expect(`${sameDocumentLink?.pathname}${sameDocumentLink?.hash}`).toBe(
      sectionTarget,
    );
    expect(
      graphSelectionForUrl(
        graph,
        new URL(
          '/code/src/app.ts?from=lat.md%2Flat%23View+Project&line=18#run',
          view.url,
        ),
      ),
    ).toEqual({
      nodeId: 'source:src/app.ts#run',
      target: '/code/src/app.ts?from=lat.md%2Flat%23View+Project&line=18#run',
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
    expect(searchReturnTo(searchHistoryState('/docs/guide#details'))).toBe(
      '/docs/guide#details',
    );
    expect(searchReturnTo(null)).toBeNull();
    expect(searchEscapeAction('runner details')).toBe('clear');
    expect(searchEscapeAction('')).toBe('close');
    expect(searchButtonAction('/docs/guide')).toBe('open');
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
          url: '/docs/guide#details',
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
    expect(document.tree).toMatchObject({ version: 1, type: 'root' });
    expect(document).not.toHaveProperty('html');
    expect(document.frontmatter.requireCodeMention).toBe(false);
    expect(document.graphNodeIds).toEqual({ '': 'document:lat.md' });
    expect(viewDocumentHtml(document)).toContain(
      '<h1 id="view-project">View Project</h1>',
    );
    expect(viewDocumentHtml(document)).toContain('href="/docs/guide#details"');
    expect(viewDocumentHtml(document)).not.toContain('require-code-mention');

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

    const linkedImage = await renderMarkdown(
      '[![CI](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/vercel-labs/lat.md/actions)',
      'lat.md',
    );
    expect(linkedImage.html).toContain(
      'href="https://github.com/vercel-labs/lat.md/actions" class="external-link"',
    );
    expect(linkedImage.html).toContain(
      '<img src="https://img.shields.io/badge/build-passing-brightgreen" alt="CI">',
    );
    expect(linkedImage.html).not.toContain('external-link-icon');

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

    const tableWithPipesInCode = await renderMarkdown(
      '| Feature | Syntax sample |\n| --- | --- |\n| Table | `\\| cell \\|` |',
      'guide.md',
    );
    expect(tableWithPipesInCode.html).toContain(
      '<td>Table</td><td><code>| cell |</code></td>',
    );

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
    expect(tasks.html).toContain('<input type="checkbox" disabled> Follow up');

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

    const repositoryReferences = await renderMarkdown(
      'Repository files keep #26, GH-26, owner/repo#26, @octocat, and a5c3785ed8d6a35868bc169f07e40e889087fd2e literal.',
      'guide.md',
    );
    expect(repositoryReferences.html).toBe(
      '<p>Repository files keep #26, GH-26, owner/repo#26, @octocat, and a5c3785ed8d6a35868bc169f07e40e889087fd2e literal.</p>',
    );

    const issueUrl = await renderMarkdown(
      'See https://github.com/jlord/sheetsee.js/issues/26.',
      'guide.md',
    );
    expect(issueUrl.html).toContain(
      'href="https://github.com/jlord/sheetsee.js/issues/26"',
    );
    expect(issueUrl.html).toContain(
      '>https://github.com/jlord/sheetsee.js/issues/26',
    );
    expect(issueUrl.html).not.toContain('>#26</a>');

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
    expect(highlightedCode.html).toContain('<code class="language-ts hljs">');
    expect(highlightedCode.html).toContain('hljs-keyword');
    expect(highlightedCode.html).toContain(
      '&#x3C;script>alert(1)&#x3C;/script>',
    );
    expect(highlightedCode.html).not.toContain('<script>');

    const unknownCode = await renderMarkdown(
      '```unknown\n<script>alert(1)</script>\n```',
      'guide.md',
    );
    expect(unknownCode.html).toContain('<code class="language-unknown">');
    expect(unknownCode.html).toContain('&#x3C;script>alert(1)&#x3C;/script>');
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
    expect(OPENFREEMAP_STYLE_URL).toBe(
      'https://tiles.openfreemap.org/styles/liberty',
    );
    let rendererImportAttempts = 0;
    const importRenderer = recoverableLazyImport(async () => {
      rendererImportAttempts++;
      if (rendererImportAttempts === 1) {
        throw new Error('renderer chunk unavailable');
      }
      return { ready: true };
    });
    const failedRendererImport = importRenderer();
    expect(importRenderer()).toBe(failedRendererImport);
    await expect(failedRendererImport).rejects.toThrow(
      'renderer chunk unavailable',
    );
    await expect(importRenderer()).resolves.toEqual({ ready: true });
    expect(rendererImportAttempts).toBe(2);
    expect(
      geoJsonBounds(
        parseGeoJson(
          '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[-122.4,37.8]}},{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[-123,38],[-121,37]]}}]}',
        ),
      ),
    ).toEqual([
      [-123, 37],
      [-121, 38],
    ]);

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
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
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
    expect(styles).toContain('.external-source-link-unavailable');
    expect(styles).toContain('-webkit-mask:');
    expect(styles.match(/\.markdown a\s*\{([^}]*)\}/)?.[1]).toContain(
      'text-decoration-line: underline;',
    );
    expect(styles.match(/\.markdown table\s*\{([^}]*)\}/)?.[1]).toContain(
      'overflow-x: auto;',
    );
    expect(styles).toContain("input[type='checkbox']");
    expect(styles).toContain('.markdown details:not(.maplibregl-ctrl-attrib)');
    expect(styles).toContain('.markdown .markdown-alert-caution');
    expect(styles).toContain('[data-footnotes]');
    expect(styles).toContain('img.markdown-emoji');
    expect(styles).toContain('.markdown .hljs-keyword');
    expect(styles).toContain('.markdown .markdown-mermaid svg');
    expect(styles).toContain('.markdown .markdown-map-canvas');
    expect(styles).toContain('.markdown .markdown-map-status');
    expect(styles).toContain('.markdown .markdown-map-error');
    expect(styles).toContain('.markdown .markdown-diagram-retry');
    expect(styles).toContain('.markdown .markdown-map .maplibregl-ctrl-group');
    const mapAttributionStyles = styles.match(
      /\.markdown \.markdown-map \.maplibregl-ctrl-attrib\s*\{([^}]*)\}/,
    )?.[1];
    expect(mapAttributionStyles).toContain('color: #333;');
    expect(mapAttributionStyles).toContain(
      'background: rgb(255 255 255 / 82%);',
    );
    expect(styles).toContain('.markdown .git-math-block.git-added');
    expect(styles).toContain('.markdown table.git-added');
    expect(styles).toContain('.markdown tr.git-removed');
    expect(styles).toContain('.markdown .markdown-stl-viewport');
    const stlCanvasStyles = styles.match(
      /\.markdown \.markdown-stl-viewport canvas\s*\{([^}]*)\}/,
    )?.[1];
    expect(stlCanvasStyles).toContain('width: 100%;');
    expect(stlCanvasStyles).toContain('height: 100%;');
  });

  // @lat: [[lat.md/view/specs#View Tests#Shows a local table of contents]]
  it('builds nested document navigation and tracks the active heading', async () => {
    const content =
      '# Guide\n\nOverview.\n\n## Features\n\nDetails.\n\n### `strict`\n\nMore details.';
    const analysis = analyzeMarkdownFile('guide.md', content, '.', '.');
    const sections = analysis.sections;
    expect(
      buildViewTableOfContents(sections, analysis.headingTitles, {
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
    expect(styles).toMatch(
      /\.source-code \{[^}]*-webkit-text-size-adjust: 100%;[^}]*text-size-adjust: 100%;/,
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
    expect(viewDocumentHtml(document)).not.toContain('require-code-mention');
  });

  // @lat: [[lat.md/view/specs#View Tests#Resolves Markdown and source wiki links]]
  it('resolves Markdown and source wiki links', async () => {
    const response = await fetch(
      new URL('/api/document?path=lat.md', view.url),
    );
    const document = (await response.json()) as ViewDocument;

    expect(viewDocumentHtml(document)).toContain(
      '<a href="/docs/guide">wiki navigation<span class="wiki-link-ref-count" aria-label="2 references">2</span></a>',
    );
    expect(viewDocumentHtml(document)).toContain(
      '<a href="/docs/guide#details">wiki heading links<span class="wiki-link-ref-count" aria-label="5 references">5</span></a>',
    );
    expect(viewDocumentHtml(document)).toContain(
      '<a href="/docs/guide#details">the same heading again<span class="wiki-link-ref-count" aria-label="5 references">5</span></a>',
    );
    expect(viewDocumentHtml(document)).toContain(
      '<a href="/docs/guide#details" class="wiki-link-segmented"><span class="wiki-link-context">guide#</span><span class="wiki-link-leaf">Details</span><span class="wiki-link-ref-count" aria-label="5 references">5</span></a>',
    );
    expect(viewDocumentHtml(document)).toContain(
      'href="/code/src/app.ts?from=lat.md%2Flat%23View+Project',
    );
    expect(viewDocumentHtml(document)).toContain('line=18#run');
    expect(viewDocumentHtml(document)).toContain(
      'class="wiki-link-segmented wiki-link-code"',
    );
    expect(viewDocumentHtml(document)).toContain(
      'class="code-link-language code-language-ts"',
    );
    expect(viewDocumentHtml(document)).toContain('class="code-link-leading"');
    expect(viewDocumentHtml(document)).toContain('aria-hidden="true"');
    expect(viewDocumentHtml(document)).toContain(
      '<span class="wiki-link-leaf">run</span><span class="wiki-link-ref-count" aria-label="2 references">2</span>',
    );
    expect(viewDocumentHtml(document)).toContain(
      'runner</span> file<span class="wiki-link-ref-count" aria-label="3 references">3</span>',
    );
    expect(viewDocumentHtml(document)).toContain(
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

    const dartLink = await renderMarkdown(
      '[[lib/service.dart#Greeter#greet]]',
      'lat.md',
      async () => ({
        href: '/code/lib/service.dart?symbol=Greeter%23greet',
        referenceCount: 0,
      }),
    );
    expect(dartLink.html).toContain(
      'class="code-link-language code-language-dart"',
    );
    expect(dartLink.html).toContain('>DART</span>');

    const javaLink = await renderMarkdown(
      '[[src/Greeter.java#Greeter#greet]]',
      'lat.md',
      async () => ({
        href: '/code/src/Greeter.java?symbol=Greeter%23greet',
        referenceCount: 0,
      }),
    );
    expect(javaLink.html).toContain(
      'class="code-link-language code-language-java"',
    );
    expect(javaLink.html).toContain('>JAVA</span>');

    for (const referenceCount of [0, 1]) {
      const sparseReferences = await renderMarkdown(
        '[[orphan]]',
        'lat.md',
        async () => ({ href: '/docs/orphan', referenceCount }),
      );
      expect(sparseReferences.html).toBe(
        '<p><a href="/docs/orphan">orphan</a></p>',
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
    expect(source).not.toHaveProperty('highlightedHtmlLines');
    expect(documentTreeToHtml(source.highlightedLines[0])).toContain(
      'class="hljs-keyword"',
    );
    const sourceMarkup = renderToStaticMarkup(
      createElement(SourceView, {
        onContentClick: () => {},
        source,
      }),
    );
    expect(sourceMarkup).toContain('class="hljs-keyword"');
    expect(sourceMarkup).not.toContain('dangerouslySetInnerHTML');
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
    url.searchParams.set('line', '18');
    const response = await fetch(url);
    const source = (await response.json()) as ViewSourceDocument;

    expect(source.context).toEqual({
      sectionId: 'lat.md/lat#View Project',
      breadcrumbs: ['lat', 'View Project'],
      paragraph:
        'Source targets such as src/app.ts#run open their definitions; the guide explains them.',
      paragraphTree: expect.objectContaining({ version: 1, type: 'root' }),
      url: '/docs/lat#view-project',
    });
    expect(source.otherReferences).toEqual([
      {
        sectionId: 'lat.md/guide#Guide#Details',
        breadcrumbs: ['guide', 'Guide', 'Details'],
        paragraph: 'The guide also references the same runner.',
        paragraphTree: expect.objectContaining({ version: 1, type: 'root' }),
        url: '/docs/guide#details',
      },
    ]);
    expect(paragraphTreeHtml(source.context)).toContain(
      'wiki-link-segmented wiki-link-code wiki-link-active',
    );
    expect(paragraphTreeHtml(source.context)).toContain(
      'code-link-language code-language-ts',
    );
    expect(paragraphTreeHtml(source.context)).toContain(
      'href="/docs/guide#details"',
    );
    expect(paragraphTreeHtml(source.otherReferences[0])).toContain(
      'wiki-link-code wiki-link-active',
    );
  });

  // @lat: [[lat.md/view/specs#View Tests#Shows section back-references]]
  it('shows section menus with references, empty state, and section actions', async () => {
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
      url: '/docs/lat#view-project',
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

    const rendered = renderToStaticMarkup(
      createElement(MarkdownContent, {
        backReferences: document.backReferences,
        tree: document.tree,
        viewMarkdownUrl: '/docs/guide.md',
      }),
    );
    expect(rendered).toContain('aria-label="Section menu, 5 references"');
    expect(rendered).toContain('<svg aria-hidden="true"');
    expect(rendered).not.toContain('<span>Refs</span>');
    expect(rendered).toContain('section-back-reference-count">5</span>');
    expect(rendered).toContain('id="section-back-references-1"');
    expect(rendered).toContain('Copy link to the section');
    expect(rendered).toContain('Copy section ID');
    expect(rendered).toContain('href="/docs/guide.md"');
    expect(rendered.match(/View Markdown file/g)).toHaveLength(1);
    expect(rendered).toContain('Show <code>lat section</code> output');
    expect(rendered).toContain('section-back-reference-breadcrumb');
    expect(rendered).toContain('section-back-reference-breadcrumb-label');
    expect(rendered).toContain('href="/code/src/app.ts?at=5"');
    expect(rendered).toContain('wiki-link-active');

    const styles = readFileSync(
      join(import.meta.dirname, '..', 'view', 'src', 'styles.css'),
      'utf8',
    );
    expect(styles).toMatch(
      /--section-menu-control: color-mix\([\s\S]*?var\(--reference-control\) 70%,[\s\S]*?var\(--background\)[\s\S]*?\);/,
    );
    expect(styles).toMatch(
      /\.section-back-reference-toggle \{[^}]*background: var\(--section-menu-control\);/,
    );
    expect(styles).toMatch(
      /\.section-back-reference-toggle:hover \{\s*background: var\(--section-menu-control-hover\);/,
    );
    expect(styles).toMatch(
      /\.section-back-reference-toggle svg \{[^}]*opacity: 0\.7;/,
    );
    expect(styles).toMatch(
      /\.section-back-reference-toggle:hover svg \{\s*opacity: 0\.82;/,
    );
    expect(styles).toMatch(
      /\.section-back-reference-actions \{\s*display: grid;/,
    );
    expect(styles).toMatch(
      /\.section-back-reference-action \{[\s\S]*?color: var\(--muted\);/,
    );
    expect(styles).toMatch(
      /\.section-back-reference-action:hover \{\s*color: color-mix\(in srgb, var\(--muted\) 82%, white\);\s*\}/,
    );

    const emptyResponse = await fetch(
      new URL('/api/document?path=lat.md', view.url),
    );
    const emptyDocument = (await emptyResponse.json()) as ViewDocument;
    const unreferenced = emptyDocument.backReferences.find(
      (section) => section.sectionId === 'lat.md/lat#View Project#Unreferenced',
    );
    expect(unreferenced).toEqual({
      sectionId: 'lat.md/lat#View Project#Unreferenced',
      headingId: 'unreferenced',
      references: [],
    });
    const emptyRendered = renderToStaticMarkup(
      createElement(MarkdownContent, {
        backReferences: [unreferenced!],
        tree: emptyDocument.tree,
      }),
    );
    expect(emptyRendered).toContain('aria-label="Section menu"');
    expect(emptyRendered).toContain('No references to this section');
    expect(emptyRendered).not.toContain('section-back-reference-count');
    expect(emptyRendered).toContain('Copy link to the section');
    expect(emptyRendered).toContain('Copy section ID');
    expect(emptyRendered).not.toContain('View Markdown file');
    expect(emptyRendered).toContain('Show <code>lat section</code> output');

    const staticRendered = renderToStaticMarkup(
      createElement(MarkdownContent, {
        backReferences: [unreferenced!],
        sectionOutputEnabled: false,
        tree: emptyDocument.tree,
      }),
    );
    expect(staticRendered).toContain('Copy section ID');
    expect(staticRendered).not.toContain('lat section</code> output');

    const navigate = vi.fn();
    const clipboard = { writeText: vi.fn(async () => {}) };
    const sectionUrl = navigateAndCopySectionLink(
      new URL('/docs/lat#view-project', view.url).href,
      'unreferenced',
      navigate,
      clipboard,
    );
    expect(sectionUrl.href).toBe(
      new URL('/docs/lat#unreferenced', view.url).href,
    );
    expect(navigate).toHaveBeenCalledWith(sectionUrl);
    expect(clipboard.writeText).toHaveBeenCalledWith(sectionUrl.href);

    copySectionId(unreferenced!.sectionId, clipboard);
    expect(clipboard.writeText).toHaveBeenLastCalledWith(
      'lat.md/lat#View Project#Unreferenced',
    );

    const sectionOutputUrl = sectionOutputRequestUrl(unreferenced!.sectionId);
    expect(sectionOutputUrl).toBe(
      '/api/section?query=lat.md%2Flat%23View%20Project%23Unreferenced',
    );
    const sectionOutputResponse = await fetch(
      new URL(sectionOutputUrl, view.url),
    );
    expect(sectionOutputResponse.status).toBe(200);
    const sectionOutput =
      (await sectionOutputResponse.json()) as ViewSectionCommandOutput;
    expect(sectionOutput.isError).toBe(false);
    expect(sectionOutput.tree).toMatchObject({ version: 1, type: 'root' });
    expect(sectionOutput).not.toHaveProperty('html');
    expect(sectionOutput.output).toContain(
      '[[lat.md/lat#View Project#Unreferenced]]',
    );
    expect(sectionOutput.output).toContain('> ## Unreferenced');
    expect(sectionOutput.output).toContain('`lat section "section#id"`');
    expect(documentTreeToHtml(sectionOutput.tree)).toContain(
      'href="/docs/lat#unreferenced"',
    );
    expect(documentTreeToHtml(sectionOutput.tree)).toContain('<blockquote>');
    expect(documentTreeToHtml(sectionOutput.tree)).toContain(
      '<h2 id="unreferenced">Unreferenced</h2>',
    );

    const referencedSectionOutputResponse = await fetch(
      new URL(sectionOutputRequestUrl('lat.md/guide#Guide#Details'), view.url),
    );
    const referencedSectionOutput =
      (await referencedSectionOutputResponse.json()) as ViewSectionCommandOutput;
    expect(referencedSectionOutput.output).toContain(
      '| `export function run(): string {`',
    );
    const referencedSectionHtml = documentTreeToHtml(
      referencedSectionOutput.tree,
    );
    expect(referencedSectionHtml).toContain(
      '<code>export function run(): string {</code>',
    );
    const codeReference = '// @' + 'lat: [[guide#Details]]';
    expect(referencedSectionHtml).toContain(`<code>${codeReference}</code>`);

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

  // @lat: [[tests/external-tests#External Sources#Browser and static export#Sidebar discovery]]
  it('builds an external sidebar tree from referenced files', () => {
    expect(buildExternalFileTree([])).toEqual([]);
    const tree = buildExternalFileTree([
      { handle: 'node', path: 'api/assert.md', target: 'node:api/assert' },
      { handle: 'node', path: 'lib/assert.js', target: 'node:lib/assert.js' },
      { handle: 'rust', path: 'guide.rst', target: 'rust:guide.rst' },
    ]);
    expect(tree.map(({ name }) => name)).toEqual(['node', 'rust']);
    const files = (node: FileTreeNode): FileTreeNode[] =>
      node.kind === 'file' ? [node] : node.children.flatMap(files);
    expect(tree.flatMap(files)).toMatchObject([
      {
        path: '@external/node/api/assert.md',
        externalTarget: 'node:api/assert',
      },
      {
        path: '@external/node/lib/assert.js',
        externalTarget: 'node:lib/assert.js',
      },
      {
        path: '@external/rust/guide.rst',
        externalTarget: 'rust:guide.rst',
      },
    ]);
    expect(externalUrl('node:api/assert')).toBe('/external/node/api/assert');
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

    expect(documentUrl('nested/my guide.md')).toBe('/docs/nested/my%20guide');
    expect(rawDocumentUrl('nested/my guide.md')).toBe(
      '/docs/nested/my%20guide.md',
    );
    expect(documentPath('/docs/nested/my%20guide')).toBe('nested/my guide.md');
    expect(documentPath('/docs/nested/my%20guide.md')).toBeNull();

    expect(viewRouteIdentity('/docs/guide#features')).toBe('/docs/guide');
    expect(viewRouteIdentity('/docs/guide#installation')).toBe('/docs/guide');
    expect(viewRouteIdentity('/code/parser.ts#parse')).toBe(
      '/code/parser.ts#parse',
    );
    expect(
      isSameRenderedDocument(
        new URL('http://lat.local/docs/guide#features'),
        new URL('http://lat.local/docs/guide#installation'),
      ),
    ).toBe(true);
    expect(
      isSameRenderedDocument(
        new URL('http://lat.local/docs/guide'),
        new URL('http://lat.local/docs/other'),
      ),
    ).toBe(false);
    expect(
      isSameRenderedDocument(
        new URL('http://lat.local/external/upstream/guide#intro'),
        new URL('http://lat.local/external/upstream/guide#navigation'),
      ),
    ).toBe(true);
  });

  // @lat: [[lat.md/view/specs#View Tests#Restores history scroll positions]]
  it('preserves scroll positions in navigation history state', () => {
    const state = historyStateWithScroll(
      searchHistoryState('/docs/guide#details'),
      { left: 12, top: 480 },
    );

    expect(searchReturnTo(state)).toBe('/docs/guide#details');
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
        'Note: use `lat ui build static` or `lat ui build server` to build a deployable UI',
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
      expect(viewDocumentHtml(initial)).toContain('class="markdown-error"');
      expect(viewDocumentHtml(initial)).toContain(
        'id="user-content-markdown-error-5"',
      );
      expect(viewDocumentHtml(initial)).toContain(
        'id="user-content-markdown-error-7"',
      );
      writeFileSync(
        rootFile,
        '# Fixed\n\nA valid overview with no broken links.\n',
      );
      await errorsView.store.refresh(['lat.md/lat.md']);
      expect(errorsView.store.getIndex().errorCounts).toEqual({});
      const fixed = await errorsView.store.getDocument('lat.md');
      expect(fixed.errors).toEqual([]);
      expect(viewDocumentHtml(fixed)).not.toContain('markdown-error');

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
      expect(viewDocumentHtml(modified)).not.toContain('git-added');
      expect(viewDocumentGitHtml(modified)).toContain('class="git-removed"');
      expect(viewDocumentGitHtml(modified)).toContain('class="git-added"');
      expect(viewDocumentGitHtml(modified)).toContain('old');
      expect(viewDocumentGitHtml(modified)).toContain('new');

      const added = await gitView.store.getDocument('fresh.md');
      expect(viewDocumentGitHtml(added)).toContain('class="git-added"');

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
        '`lat ui` starts listening before passing the loopback URL to the platform browser launcher, then reports the URL and points users to the build commands for deployment.',
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

  it('renders compatible table edits within one table', async () => {
    const base = [
      '| Feature | Syntax sample | Status |',
      '| --- | --- | --- |',
      '| Inline code | `const` | Stable |',
      '| Description | old renderer stays | Stable |',
      '| Removed row | old value | Gone |',
      '| Stable row | same value | Here |',
    ].join('\n');
    const current = [
      '| Feature | Syntax sample | Status |',
      '| --- | --- | --- |',
      '| Inline code | `co1nst` | Stable |',
      '| Description | new renderer stays | Stable |',
      '| Stable row | same value | Here |',
      '| Added row | new value | Here |',
    ].join('\n');
    const rendered = await renderMarkdown(
      current,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(base, current),
    );

    expect(rendered.html.match(/<table/g)).toHaveLength(1);
    expect(rendered.html).toContain(
      '<td><del class="git-removed"><code>const</code></del><ins class="git-added"><code>co1nst</code></ins></td>',
    );
    expect(rendered.html).toContain(
      '<del class="git-removed">old</del><ins class="git-added">new</ins> renderer stays',
    );
    expect(rendered.html).toContain('<tr class="git-removed">');
    expect(rendered.html).toContain('<tr class="git-added">');
  });

  it('colors whole-table fallbacks for incompatible table edits', async () => {
    const base = '| Feature | Status |\n| --- | --- |\n| Table | Old |';
    const current =
      '| Feature | Syntax | Status |\n| --- | --- | --- |\n| Table | New | Ready |';
    const rendered = await renderMarkdown(
      current,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(base, current),
    );

    expect(rendered.html.match(/<table/g)).toHaveLength(2);
    expect(rendered.html).toContain('<table class="git-removed">');
    expect(rendered.html).toContain('<table class="git-added">');

    const realignedBase = '| Feature |\n| :--- |\n| Table |';
    const realignedCurrent = '| Feature |\n| ---: |\n| Table |';
    const realigned = await renderMarkdown(
      realignedCurrent,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(realignedBase, realignedCurrent),
    );
    expect(realigned.html.match(/<table/g)).toHaveLength(2);
    expect(realigned.html).toContain('<table class="git-removed">');
    expect(realigned.html).toContain('<table class="git-added">');
  });

  it('keeps changed math rendered while marking old and new formulas', async () => {
    const inlineBase = 'The inline formula $x^2$ stays rendered.';
    const inlineCurrent = 'The inline formula $x^3$ stays rendered.';
    const inline = await renderMarkdown(
      inlineCurrent,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(inlineBase, inlineCurrent),
    );
    expect(inline.html.match(/class="katex"/g)).toHaveLength(2);
    expect(inline.html).toContain(
      '<del class="git-removed"><span class="katex">',
    );
    expect(inline.html).toContain(
      '<ins class="git-added"><span class="katex">',
    );

    const displayBase = '$$\n\\int_0^1 x^2 \\, dx\n$$';
    const displayCurrent = '$$\n\\int_0^1 x^3 \\, dx\n$$';
    const display = await renderMarkdown(
      displayCurrent,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(displayBase, displayCurrent),
    );
    expect(display.html.match(/class="katex-display"/g)).toHaveLength(2);
    expect(display.html).toMatch(
      /<div class="git-math-block git-removed">\s*<span class="katex-display">/,
    );
    expect(display.html).toMatch(
      /<div class="git-math-block git-added">\s*<span class="katex-display">/,
    );

    const fencedBase = '```math\nx^2\n```';
    const fencedCurrent = '```math\nx^3\n```';
    const fenced = await renderMarkdown(
      fencedCurrent,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree(fencedBase, fencedCurrent),
    );
    expect(fenced.html.match(/class="katex-display"/g)).toHaveLength(2);
    expect(fenced.html).toContain('class="git-math-block git-removed"');
    expect(fenced.html).toContain('class="git-math-block git-added"');
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
      '| New | Table |',
      '| --- | --- |',
      '| Added | Row |',
      '',
      '$$',
      'x^2',
      '$$',
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
    expect(rendered.html).toContain('<table class="git-added">');
    expect(rendered.html).toMatch(
      /<div class="git-math-block git-added">\s*<span class="katex-display">/,
    );
  });
});

describe('lat ui live project index', () => {
  // @lat: [[lat.md/view/specs#View Tests#Edits local Markdown safely]]
  it('applies editor patches over unrelated disk changes and rejects overlaps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lat-view-edit-'));
    const liveLatDir = join(root, 'lat.md');
    const documentPath = join(liveLatDir, 'lat.md');
    mkdirSync(liveLatDir);
    const base =
      '# Editable\n\nThe editable document.\n\n## User area\n\nOriginal user text.\n\n## Concurrent area\n\nOriginal concurrent text.\n';
    writeFileSync(documentPath, base);
    const live = await startViewServer(
      {
        latDir: liveLatDir,
        projectRoot: root,
        styler: plainStyler,
        mode: 'cli',
      },
      { clientDir: root, git: false, watch: false },
    );

    try {
      const sourceResponse = await fetch(
        new URL('/api/document-source?path=lat.md', live.url),
      );
      expect(sourceResponse.status).toBe(200);
      await expect(sourceResponse.json()).resolves.toEqual({
        path: 'lat.md',
        content: base,
      } satisfies ViewDocumentSource);

      const concurrent = base.replace(
        'Original concurrent text.',
        'Concurrent disk text.',
      );
      writeFileSync(documentPath, concurrent);
      const edited = base.replace('Original user text.', 'Edited user text.');
      const editResponse = await fetch(
        new URL('/api/document?path=lat.md', live.url),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseContent: base, content: edited }),
        },
      );
      expect(editResponse.status).toBe(200);
      const edit = (await editResponse.json()) as ViewDocumentEditResponse;
      expect(edit.merged).toBe(true);
      expect(edit.content).toContain('Edited user text.');
      expect(edit.content).toContain('Concurrent disk text.');
      expect(readFileSync(documentPath, 'utf8')).toBe(edit.content);
      expect(live.store.snapshot.files.get('lat.md')?.content).toBe(
        edit.content,
      );

      writeFileSync(
        documentPath,
        edit.content.replace('Edited user text.', 'Second disk edit.'),
      );
      const conflictResponse = await fetch(
        new URL('/api/document?path=lat.md', live.url),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseContent: edit.content,
            content: edit.content.replace(
              'Edited user text.',
              'Second browser edit.',
            ),
          }),
        },
      );
      expect(conflictResponse.status).toBe(409);
      await expect(conflictResponse.json()).resolves.toEqual({
        error:
          'Could not save because this file changed in the same area. Your edits are still in the editor.',
      });
      expect(readFileSync(documentPath, 'utf8')).toContain('Second disk edit.');

      const outside = await fetch(
        new URL('/api/document-source?path=../README.md', live.url),
      );
      expect(outside.status).toBe(404);
    } finally {
      await live.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

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
      const readyMessage = decoder.decode(ready.value);
      expect(readyMessage).toContain('event: ready');
      const readyData = readyMessage.match(/data: (\{.*\})/)?.[1];
      expect(readyData).toBeDefined();
      expect(JSON.parse(readyData!)).toMatchObject({
        instanceId: expect.any(String),
        generation: 0,
        markdownGeneration: 0,
      });

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
