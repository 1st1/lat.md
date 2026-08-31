import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { plainStyler, type CmdContext } from '../../src/context.js';
import { parsedCachePath } from '../../src/parser-cache.js';
import type {
  ViewDocument,
  ViewExternalDocument,
  ViewGraph,
  ViewIndex,
} from '../../src/view/protocol.js';
import type { ViewStaticManifest } from '../../src/view/static-protocol.js';
import { startViewServer } from '../../src/view/server.js';
import { buildStaticView } from '../../src/view/static-build.js';
import {
  createExternalGitFixture,
  createExternalProject,
  TEST_CERT_PATH,
  type ExternalGitFixture,
} from './support.js';
import { rmDirBestEffort } from '../util.js';
import { documentTreeToHtml } from '../document-tree.js';

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

const REFERENCED_EXTERNAL_BODY =
  'Read [[upstream:guide#Navigation]], [[upstream:guide.rst#navigation]], [[upstream:guide.adoc#navigation]], [[upstream:widget.ts#widget]], and [[upstream:widget.ts#gadget]].';

function commandContext(project: { root: string; latDir: string }): CmdContext {
  return {
    latDir: project.latDir,
    projectRoot: project.root,
    styler: plainStyler,
    mode: 'cli',
  };
}

function selectLocalCommit(
  project: { latDir: string },
  fixture: ExternalGitFixture,
): void {
  writeFileSync(
    join(project.latDir, 'config.local.yaml'),
    `external-sources:\n  upstream:\n    local-path: ${fixture.checkout}\n    commit: ${fixture.commit2}\n`,
  );
}

function html(document: ViewDocument): string {
  return documentTreeToHtml(document.tree);
}

describe.sequential('external source view', () => {
  let fixture: ExternalGitFixture;
  const roots: string[] = [];
  const previousCa = process.env.GIT_SSL_CAINFO;

  beforeAll(async () => {
    fixture = await createExternalGitFixture();
    process.env.GIT_SSL_CAINFO = TEST_CERT_PATH;
  }, 30_000);

  afterAll(async () => {
    if (previousCa === undefined) delete process.env.GIT_SSL_CAINFO;
    else process.env.GIT_SSL_CAINFO = previousCa;
    for (const root of roots) rmDirBestEffort(root);
    await fixture.close();
  });

  // @lat: [[tests/external-tests#External Sources#Browser and static export#Live external previews]]
  it('renders live external previews and graph relationships', async () => {
    const project = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
      localPath: fixture.checkout,
      defaultFileExtension: 'md',
      body: REFERENCED_EXTERNAL_BODY,
    });
    roots.push(project.root);
    selectLocalCommit(project, fixture);
    const ctx = commandContext(project);

    const server = await startViewServer(ctx, {
      git: false,
      port: 0,
      watch: false,
      externalCa: fixture.ca,
    });
    try {
      const index = await json<ViewIndex>(`${server.url}api/index`);
      expect(index.externalFiles).toEqual([
        {
          handle: 'upstream',
          path: 'guide.adoc',
          target: 'upstream:guide.adoc',
        },
        {
          handle: 'upstream',
          path: 'guide.md',
          target: 'upstream:guide',
        },
        {
          handle: 'upstream',
          path: 'guide.rst',
          target: 'upstream:guide.rst',
        },
        {
          handle: 'upstream',
          path: 'widget.ts',
          target: 'upstream:widget.ts',
        },
      ]);
      const document = await json<ViewDocument>(
        `${server.url}api/document?path=lat.md`,
      );
      expect(document.tree).toMatchObject({ version: 1, type: 'root' });
      expect(document).not.toHaveProperty('html');
      expect(html(document)).toContain('/external/upstream/guide#Navigation');
      expect(html(document)).toContain(
        '/external/upstream/guide.rst#navigation',
      );
      expect(html(document)).toContain(
        '/external/upstream/guide.adoc#navigation',
      );
      expect(html(document)).toContain('/external/upstream/widget.ts#widget');

      const externalDocument = await json<ViewExternalDocument>(
        `${server.url}api/external?target=${encodeURIComponent('upstream:guide.md')}`,
      );
      expect(externalDocument.kind).toBe('markdown');
      if (externalDocument.kind === 'markdown') {
        expect(externalDocument.target).toBe('upstream:guide');
        expect(externalDocument.document.tree).toMatchObject({
          version: 1,
          type: 'root',
        });
        expect(externalDocument.document).not.toHaveProperty('html');
        expect(html(externalDocument.document)).toContain(
          'Second version navigation.',
        );
        expect(externalDocument.document.backReferences).toHaveLength(2);
        expect(
          externalDocument.document.backReferences.find(
            (section) => section.headingId === 'guide',
          )?.references,
        ).toEqual([]);
      }

      for (const [target, text] of [
        [
          'upstream:guide.rst#navigation',
          'Second version reStructuredText navigation.',
        ],
        [
          'upstream:guide.adoc#navigation',
          'Second version AsciiDoc navigation.',
        ],
      ] as const) {
        const externalDocument = await json<ViewExternalDocument>(
          `${server.url}api/external?target=${encodeURIComponent(target)}`,
        );
        expect(externalDocument.kind).toBe('markdown');
        if (externalDocument.kind === 'markdown') {
          expect(html(externalDocument.document)).toContain(text);
          expect(externalDocument.document.tableOfContents).toContainEqual(
            expect.objectContaining({ id: 'navigation', title: 'Navigation' }),
          );
          expect(externalDocument.document.backReferences).toHaveLength(2);
        }
      }

      const externalSource = await json<ViewExternalDocument>(
        `${server.url}api/external?target=${encodeURIComponent('upstream:widget.ts#widget')}`,
      );
      expect(externalSource.kind).toBe('source');
      if (externalSource.kind === 'source') {
        expect(externalSource.source.focus?.symbol).toBe('widget');
        expect(externalSource.source.content).toContain('return "second"');
      }
      expect(
        existsSync(
          parsedCachePath(project.latDir, '@external/upstream/widget.ts'),
        ),
      ).toBe(true);

      const graph = await json<ViewGraph>(`${server.url}api/graph`);
      expect(
        graph.nodes.some(
          (node) =>
            node.id === 'external-document:upstream:guide' && node.inDegree > 0,
        ),
      ).toBe(true);
      expect(
        graph.nodes.some(
          (node) =>
            node.id === 'external-document:upstream:guide.rst' &&
            node.inDegree > 0,
        ),
      ).toBe(true);
      expect(
        graph.nodes.some(
          (node) =>
            node.id === 'external-document:upstream:guide.adoc' &&
            node.inDegree > 0,
        ),
      ).toBe(true);
      expect(
        graph.nodes.some(
          (node) => node.id === 'external-source:upstream:widget.ts#widget',
        ),
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  // @lat: [[tests/external-tests#External Sources#Browser and static export#Local watcher refresh]]
  it('refreshes dirty local content after a watched file changes', async () => {
    const project = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
      localPath: fixture.checkout,
      defaultFileExtension: 'md',
      body: 'Read [[upstream:guide#Navigation]].',
    });
    roots.push(project.root);
    selectLocalCommit(project, fixture);
    const guidePath = join(fixture.checkout, 'docs', 'guide.md');
    const originalGuide = readFileSync(guidePath, 'utf8');
    const server = await startViewServer(commandContext(project), {
      git: false,
      port: 0,
      externalCa: fixture.ca,
    });
    try {
      const generation = server.store.snapshot.generation;

      const changed = new Promise<void>((resolveChange, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('external watcher did not refresh')),
          5_000,
        );
        const unsubscribe = server.store.subscribe((change) => {
          if (change.generation <= generation) return;
          clearTimeout(timeout);
          unsubscribe();
          resolveChange();
        });
      });
      writeFileSync(
        guidePath,
        '# Guide\n\nPinned guide.\n\n## Navigation\n\nLive dirty navigation.\n',
      );
      await changed;
      const refreshed = await json<ViewExternalDocument>(
        `${server.url}api/external?target=${encodeURIComponent('upstream:guide')}`,
      );
      expect(refreshed.kind).toBe('markdown');
      if (refreshed.kind === 'markdown') {
        expect(html(refreshed.document)).toContain('Live dirty navigation.');
      }
    } finally {
      await server.close();
      writeFileSync(guidePath, originalGuide);
    }
  });

  // @lat: [[tests/external-tests#External Sources#Browser and static export#Unused source omission]]
  it('omits configured external sources without references', async () => {
    const unusedProject = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
      body: 'No external references.',
    });
    roots.push(unusedProject.root);
    const unusedServer = await startViewServer(
      {
        latDir: unusedProject.latDir,
        projectRoot: unusedProject.root,
        styler: plainStyler,
        mode: 'cli',
      },
      { git: false, port: 0, watch: false, externalCa: fixture.ca },
    );
    try {
      const index = await json<ViewIndex>(`${unusedServer.url}api/index`);
      expect(index.externalFiles).toEqual([]);
    } finally {
      await unusedServer.close();
    }
  });

  // @lat: [[tests/external-tests#External Sources#Browser and static export#Canonical static export]]
  it('builds a canonical offline static bundle without Git storage', async () => {
    const project = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
      localPath: fixture.checkout,
      defaultFileExtension: 'md',
      body: REFERENCED_EXTERNAL_BODY,
    });
    roots.push(project.root);
    selectLocalCommit(project, fixture);
    const ctx = commandContext(project);

    const buildRoot = mkdtempSync(join(tmpdir(), 'lat-external-static-'));
    roots.push(buildRoot);
    const clientDir = join(buildRoot, 'client');
    const outputDir = join(buildRoot, 'site');
    mkdirSync(clientDir);
    writeFileSync(
      join(clientDir, 'index.html'),
      '<!doctype html><html><head></head><body>lat ui</body></html>',
    );
    await buildStaticView(ctx, outputDir, {
      basePath: '/docs/',
      clientDir,
      externalCa: fixture.ca,
    });
    const manifest = JSON.parse(
      readFileSync(join(outputDir, 'docs', 'data', 'manifest.json'), 'utf8'),
    ) as ViewStaticManifest;
    expect(Object.keys(manifest.externals).sort()).toEqual([
      'upstream:guide',
      'upstream:guide.adoc',
      'upstream:guide.rst',
      'upstream:widget.ts',
      'upstream:widget.ts#gadget',
      'upstream:widget.ts#widget',
    ]);
    expect(manifest.index.externalFiles).toEqual([
      {
        handle: 'upstream',
        path: 'guide.adoc',
        target: 'upstream:guide.adoc',
      },
      {
        handle: 'upstream',
        path: 'guide.md',
        target: 'upstream:guide',
      },
      {
        handle: 'upstream',
        path: 'guide.rst',
        target: 'upstream:guide.rst',
      },
      {
        handle: 'upstream',
        path: 'widget.ts',
        target: 'upstream:widget.ts',
      },
    ]);
    const widgetFile = manifest.externals['upstream:widget.ts'];
    const widget = manifest.externals['upstream:widget.ts#widget'];
    const gadget = manifest.externals['upstream:widget.ts#gadget'];
    expect(widgetFile.kind).toBe('source');
    expect(widget.kind).toBe('source');
    expect(gadget.kind).toBe('source');
    if (
      widgetFile.kind === 'source' &&
      widget.kind === 'source' &&
      gadget.kind === 'source'
    ) {
      expect(widgetFile.file).toBe(widget.file);
      expect(widget.file).toBe(gadget.file);
    }
    const guide = manifest.externals['upstream:guide'];
    expect(guide.kind).toBe('markdown');
    if (guide.kind === 'markdown') {
      const payload = JSON.parse(
        readFileSync(join(outputDir, 'docs', guide.document), 'utf8'),
      ) as ViewExternalDocument;
      expect(payload.kind).toBe('markdown');
      if (payload.kind === 'markdown') {
        expect(html(payload.document)).toContain('First version navigation.');
        expect(html(payload.document)).not.toContain('Live dirty navigation.');
      }
    }
    for (const [target, text] of [
      ['upstream:guide.rst', 'First version reStructuredText navigation.'],
      ['upstream:guide.adoc', 'First version AsciiDoc navigation.'],
    ] as const) {
      const entry = manifest.externals[target];
      expect(entry.kind).toBe('markdown');
      if (entry.kind === 'markdown') {
        const payload = JSON.parse(
          readFileSync(join(outputDir, 'docs', entry.document), 'utf8'),
        ) as ViewExternalDocument;
        expect(payload.kind).toBe('markdown');
        if (payload.kind === 'markdown') {
          expect(html(payload.document)).toContain(text);
          expect(html(payload.document)).not.toContain('Second version');
        }
      }
    }
    expect(
      existsSync(
        join(outputDir, 'docs', 'external', 'upstream', 'guide', 'index.html'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          outputDir,
          'docs',
          'external',
          'upstream',
          'guide.rst',
          'index.html',
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          outputDir,
          'docs',
          'external',
          'upstream',
          'guide.adoc',
          'index.html',
        ),
      ),
    ).toBe(true);
    expect(existsSync(join(outputDir, 'docs', '.git'))).toBe(false);
  });

  // @lat: [[tests/external-tests#External Sources#Browser and static export#Validation diagnostics]]
  it('surfaces broken external fragments as document diagnostics', async () => {
    const brokenProject = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
      defaultFileExtension: 'md',
      body: 'Broken [[upstream:guide#Missing heading]].',
    });
    roots.push(brokenProject.root);
    const brokenServer = await startViewServer(
      {
        latDir: brokenProject.latDir,
        projectRoot: brokenProject.root,
        styler: plainStyler,
        mode: 'cli',
      },
      { git: false, port: 0, watch: false, externalCa: fixture.ca },
    );
    try {
      const index = await json<ViewIndex>(`${brokenServer.url}api/index`);
      expect(index.errorCounts['lat.md']).toBeGreaterThan(0);
      const document = await json<ViewDocument>(
        `${brokenServer.url}api/document?path=lat.md`,
      );
      expect(document.errors[0].target).toBe('upstream:guide#Missing heading');
      expect(html(document)).toContain('markdown-error');
    } finally {
      await brokenServer.close();
    }
  });
});
