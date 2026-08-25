import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainStyler, type CmdContext } from '../src/context.js';
import { uiCommand } from '../src/cli/ui.js';
import { startViewServer, type ViewServer } from '../src/view/server.js';
import { highlightSource } from '../src/view/highlight.js';
import { buildGitDiffTree } from '../src/view/git-diff.js';
import { renderMarkdown } from '../src/view/markdown.js';
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
  fileTreeErrorCount,
  fileTreeGitStatus,
} from '../view/src/file-tree.js';
import {
  historyScrollPosition,
  historyStateWithScroll,
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

describe('lat ui', () => {
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
    writeFileSync(join(clientDir, 'index.html'), '<main>lat ui shell</main>');
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
    expect(document.html).toContain('<h1 id="view-project">View Project</h1>');
    expect(document.html).toContain('href="guide.md#details"');
    expect(document.html).not.toContain('require-code-mention');
  });

  // @lat: [[lat.md/view/specs#View Tests#Exposes code-mention frontmatter as metadata]]
  it('exposes code-mention frontmatter as document metadata', async () => {
    const response = await fetch(
      new URL('/api/document?path=guide.md', view.url),
    );
    const document = (await response.json()) as ViewDocument;

    expect(document.frontmatter.requireCodeMention).toBe(true);
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
    expect(document.html).toContain('aria-hidden="true"');
    expect(document.html).toContain(
      '<span class="wiki-link-leaf">run</span><span class="wiki-link-ref-count" aria-label="2 references">2</span>',
    );
    expect(document.html).toContain(
      'runner file<span class="wiki-link-ref-count" aria-label="3 references">3</span>',
    );
    expect(document.html).toContain(
      'same file<span class="wiki-link-ref-count" aria-label="3 references">3</span>',
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

    const borderlineReplacement = 'Shared new four five six.';
    const borderline = await renderMarkdown(
      borderlineReplacement,
      'lat.md',
      undefined,
      {},
      buildGitDiffTree('Shared old one two three.', borderlineReplacement),
    );
    expect(borderline.html).toContain(
      '<p class="git-removed">Shared old one two three.</p>',
    );
    expect(borderline.html).toContain(
      '<p class="git-added">Shared new four five six.</p>',
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
