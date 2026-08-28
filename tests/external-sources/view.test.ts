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

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
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

  // @lat: [[tests/external-tests#External Sources#Browser and static export]]
  it('renders live previews and a canonical offline static bundle', async () => {
    const project = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
      localPath: fixture.checkout,
      body: 'Read [[upstream:guide.md#Navigation]], [[upstream:widget.ts#widget]], and [[upstream:widget.ts#gadget]].',
    });
    roots.push(project.root);
    writeFileSync(
      join(project.latDir, 'config.local.yaml'),
      `external-sources:\n  upstream:\n    local-path: ${fixture.checkout}\n    commit: ${fixture.commit2}\n`,
    );
    const ctx: CmdContext = {
      latDir: project.latDir,
      projectRoot: project.root,
      styler: plainStyler,
      mode: 'cli',
    };

    const server = await startViewServer(ctx, {
      git: false,
      port: 0,
      externalCa: fixture.ca,
    });
    try {
      const document = await json<ViewDocument>(
        `${server.url}api/document?path=lat.md`,
      );
      expect(document.html).toContain('/external/upstream/guide.md#Navigation');
      expect(document.html).toContain('/external/upstream/widget.ts#widget');

      const externalDocument = await json<ViewExternalDocument>(
        `${server.url}api/external?target=${encodeURIComponent('upstream:guide.md')}`,
      );
      expect(externalDocument.kind).toBe('markdown');
      if (externalDocument.kind === 'markdown') {
        expect(externalDocument.document.html).toContain(
          'Second version navigation.',
        );
        expect(externalDocument.document.backReferences).toHaveLength(1);
      }

      const externalSource = await json<ViewExternalDocument>(
        `${server.url}api/external?target=${encodeURIComponent('upstream:widget.ts#widget')}`,
      );
      expect(externalSource.kind).toBe('source');
      if (externalSource.kind === 'source') {
        expect(externalSource.source.focus?.symbol).toBe('widget');
        expect(externalSource.source.content).toContain('return "second"');
      }

      const graph = await json<ViewGraph>(`${server.url}api/graph`);
      expect(
        graph.nodes.some(
          (node) =>
            node.id === 'external-document:upstream:guide.md' &&
            node.inDegree > 0,
        ),
      ).toBe(true);
      expect(
        graph.nodes.some(
          (node) => node.id === 'external-source:upstream:widget.ts#widget',
        ),
      ).toBe(true);

      const changed = new Promise<void>((resolveChange, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('external watcher did not refresh')),
          5_000,
        );
        const unsubscribe = server.store.subscribe(() => {
          clearTimeout(timeout);
          unsubscribe();
          resolveChange();
        });
      });
      writeFileSync(
        join(fixture.checkout, 'docs', 'guide.md'),
        '# Guide\n\nPinned guide.\n\n## Navigation\n\nLive dirty navigation.\n',
      );
      await changed;
      const refreshed = await json<ViewExternalDocument>(
        `${server.url}api/external?target=${encodeURIComponent('upstream:guide.md')}`,
      );
      expect(refreshed.kind).toBe('markdown');
      if (refreshed.kind === 'markdown') {
        expect(refreshed.document.html).toContain('Live dirty navigation.');
      }
    } finally {
      await server.close();
    }

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
      'upstream:guide.md',
      'upstream:widget.ts#gadget',
      'upstream:widget.ts#widget',
    ]);
    const widget = manifest.externals['upstream:widget.ts#widget'];
    const gadget = manifest.externals['upstream:widget.ts#gadget'];
    expect(widget.kind).toBe('source');
    expect(gadget.kind).toBe('source');
    if (widget.kind === 'source' && gadget.kind === 'source') {
      expect(widget.file).toBe(gadget.file);
    }
    const guide = manifest.externals['upstream:guide.md'];
    expect(guide.kind).toBe('markdown');
    if (guide.kind === 'markdown') {
      const payload = JSON.parse(
        readFileSync(join(outputDir, 'docs', guide.document), 'utf8'),
      ) as ViewExternalDocument;
      expect(payload.kind).toBe('markdown');
      if (payload.kind === 'markdown') {
        expect(payload.document.html).toContain('First version navigation.');
        expect(payload.document.html).not.toContain('Live dirty navigation.');
      }
    }
    expect(
      existsSync(
        join(
          outputDir,
          'docs',
          'external',
          'upstream',
          'guide.md',
          'index.html',
        ),
      ),
    ).toBe(true);
    expect(existsSync(join(outputDir, 'docs', '.git'))).toBe(false);

    const brokenProject = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
      body: 'Broken [[upstream:guide.md#Missing heading]].',
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
      expect(document.errors[0].target).toBe(
        'upstream:guide.md#Missing heading',
      );
      expect(document.html).toContain('markdown-error');
    } finally {
      await brokenServer.close();
    }
  }, 30_000);
});
