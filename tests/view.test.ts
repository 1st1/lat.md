import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainStyler, type CmdContext } from '../src/context.js';
import { viewCommand } from '../src/cli/view.js';
import { startViewServer, type ViewServer } from '../src/view/server.js';
import { highlightSource } from '../src/view/highlight.js';
import type {
  ViewDocument,
  ViewIndex,
  ViewSearchResponse,
  ViewSourceDocument,
} from '../src/view/protocol.js';
import { createViewSearch } from '../src/view/search.js';
import {
  buildFileTree,
  directoryIndex,
  expandDirectory,
} from '../view/src/file-tree.js';
import {
  scrollToDocumentLocation,
  searchEscapeAction,
  searchHistoryState,
  searchQuery,
  searchReturnTo,
  searchUrl,
} from '../view/src/navigation.js';
import { renderSectionBackReferences } from '../view/src/section-back-references.js';
import {
  captureScrollAnchor,
  restoreScrollAnchor,
} from '../view/src/scroll-anchor.js';
import {
  getSourceWindow,
  getSourceWindowRows,
} from '../view/src/source-window.js';

const projectRoot = join(import.meta.dirname, 'cases', 'view-project');
const latDir = join(projectRoot, 'lat.md');

function testContext(): CmdContext {
  return { latDir, projectRoot, styler: plainStyler, mode: 'cli' };
}

describe('lat view', () => {
  let clientDir: string;
  let view: ViewServer;
  const runIndex = vi.fn(async () => {});
  const runSearch = vi.fn(async (_latDir: string, query: string) => ({
    query,
    matches: [
      {
        reason: 'semantic match',
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
    writeFileSync(join(clientDir, 'index.html'), '<main>lat view shell</main>');
    view = await startViewServer(testContext(), {
      clientDir,
      search: createViewSearch(latDir, { runIndex, runSearch }),
    });
  });

  afterAll(async () => {
    await view.close();
    rmSync(clientDir, { recursive: true, force: true });
  });

  // @lat: [[view#Serves the document index and browser shell]]
  it('serves the document index and browser shell', async () => {
    const indexResponse = await fetch(new URL('/api/index', view.url));
    expect(indexResponse.status).toBe(200);
    expect((await indexResponse.json()) as ViewIndex).toEqual({
      files: ['guide.md', 'lat.md'],
      entry: 'lat.md',
    });

    const rootResponse = await fetch(view.url, { redirect: 'manual' });
    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.get('location')).toBe('/docs/lat.md');

    const shellResponse = await fetch(new URL('/docs/guide.md', view.url));
    expect(shellResponse.status).toBe(200);
    expect(await shellResponse.text()).toContain('lat view shell');

    const sourceShell = await fetch(new URL('/code/src/app.ts', view.url));
    expect(sourceShell.status).toBe(200);
    expect(await sourceShell.text()).toContain('lat view shell');

    const searchShell = await fetch(new URL('/search', view.url));
    expect(searchShell.status).toBe(200);
    expect(await searchShell.text()).toContain('lat view shell');
  });

  // @lat: [[view#Searches sections with embeddings]]
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

  // @lat: [[view#Renders Markdown with navigable local links]]
  it('renders Markdown with navigable local links', async () => {
    const response = await fetch(
      new URL('/api/document?path=lat.md', view.url),
    );
    expect(response.status).toBe(200);
    const document = (await response.json()) as ViewDocument;

    expect(document.title).toBe('View Project');
    expect(document.frontmatter.requireCodeMention).toBe(false);
    expect(document.html).toContain('<h1 id="view-project">View Project</h1>');
    expect(document.html).toContain('href="guide.md#details"');
    expect(document.html).not.toContain('require-code-mention');
  });

  // @lat: [[view#Exposes code-mention frontmatter as metadata]]
  it('exposes code-mention frontmatter as document metadata', async () => {
    const response = await fetch(
      new URL('/api/document?path=guide.md', view.url),
    );
    const document = (await response.json()) as ViewDocument;

    expect(document.frontmatter.requireCodeMention).toBe(true);
    expect(document.html).not.toContain('require-code-mention');
  });

  // @lat: [[view#Resolves Markdown and source wiki links]]
  it('resolves Markdown and source wiki links', async () => {
    const response = await fetch(
      new URL('/api/document?path=lat.md', view.url),
    );
    const document = (await response.json()) as ViewDocument;

    expect(document.html).toContain(
      '<a href="/docs/guide.md">wiki navigation</a>',
    );
    expect(document.html).toContain(
      '<a href="/docs/guide.md#details">wiki heading links</a>',
    );
    expect(document.html).toContain(
      '<a href="/docs/guide.md#details" class="wiki-link-segmented"><span class="wiki-link-context">guide#</span><span class="wiki-link-leaf">Details</span></a>',
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
    expect(document.html).toContain('aria-hidden="true"');
  });

  // @lat: [[view#Serves source definitions securely]]
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

  // @lat: [[view#Shows source reference context]]
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

  // @lat: [[view#Shows section back-references]]
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

  // @lat: [[view#Places context within a collapsed source window]]
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

  // @lat: [[view#Highlights source syntax safely]]
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

  // @lat: [[view#Builds a nested file tree]]
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

    const directory = { open: false };
    expandDirectory(directory);
    expect(directory.open).toBe(true);
  });

  // @lat: [[view#Stabilizes fragment navigation immediately]]
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
  });

  // @lat: [[view#Rejects files outside the Markdown vault]]
  it('rejects files outside the Markdown vault', async () => {
    const outside = await fetch(
      new URL('/api/document?path=../package.json', view.url),
    );
    expect(outside.status).toBe(404);
    await expect(outside.json()).resolves.toEqual({
      error: 'Markdown document not found',
    });
  });

  // @lat: [[view#Launches the browser after the server starts]]
  it('launches the browser after the server starts', async () => {
    const openBrowser = vi.fn(async () => {});
    let started: ViewServer | undefined;

    const result = await viewCommand(testContext(), {
      clientDir,
      openBrowser,
      onStarted(server) {
        started = server;
      },
    });

    expect(started).toBeDefined();
    expect(openBrowser).toHaveBeenCalledWith(started!.url);
    expect(result.output).toBe(`Viewing lat.md at ${started!.url}`);
    await started!.close();
  });
});
