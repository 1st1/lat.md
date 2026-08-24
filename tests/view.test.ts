import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainStyler, type CmdContext } from '../src/context.js';
import { viewCommand } from '../src/cli/view.js';
import { startViewServer, type ViewServer } from '../src/view/server.js';
import type { ViewDocument, ViewIndex } from '../src/view/protocol.js';
import { buildFileTree } from '../view/src/file-tree.js';

const projectRoot = join(import.meta.dirname, 'cases', 'view-project');
const latDir = join(projectRoot, 'lat.md');

function testContext(): CmdContext {
  return { latDir, projectRoot, styler: plainStyler, mode: 'cli' };
}

describe('lat view', () => {
  let clientDir: string;
  let view: ViewServer;

  beforeAll(async () => {
    clientDir = mkdtempSync(join(tmpdir(), 'lat-view-client-'));
    writeFileSync(join(clientDir, 'index.html'), '<main>lat view shell</main>');
    view = await startViewServer(testContext(), { clientDir });
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
  });

  // @lat: [[view#Renders Markdown with navigable local links]]
  it('renders Markdown with navigable local links', async () => {
    const response = await fetch(
      new URL('/api/document?path=lat.md', view.url),
    );
    expect(response.status).toBe(200);
    const document = (await response.json()) as ViewDocument;

    expect(document.title).toBe('View Project');
    expect(document.html).toContain('<h1 id="view-project">View Project</h1>');
    expect(document.html).toContain('href="guide.md#details"');
    expect(document.html).not.toContain('require-code-mention');
  });

  // @lat: [[view#Resolves Markdown wiki links but leaves source links as text]]
  it('resolves Markdown wiki links but leaves source links as text', async () => {
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
    expect(document.html).toContain('[[src/app.ts#run]]');
  });

  // @lat: [[view#Builds a nested file tree]]
  it('builds a nested file tree', () => {
    expect(
      buildFileTree([
        'lat.md',
        'guides/setup.md',
        'guides/guides.md',
        'api.md',
      ]),
    ).toEqual([
      {
        kind: 'directory',
        name: 'guides',
        path: 'guides',
        children: [
          { kind: 'file', name: 'guides.md', path: 'guides/guides.md' },
          { kind: 'file', name: 'setup.md', path: 'guides/setup.md' },
        ],
      },
      { kind: 'file', name: 'api.md', path: 'api.md' },
      { kind: 'file', name: 'lat.md', path: 'lat.md' },
    ]);
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
