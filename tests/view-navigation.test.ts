import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkIndex } from '../src/cli/check.js';
import { plainStyler } from '../src/context.js';
import { buildStaticView } from '../src/view/static-build.js';
import type { ViewStaticManifest } from '../src/view/static-protocol.js';
import { createViewStore, type ViewStore } from '../src/view/store.js';
import { FileTree } from '../view/src/FileTree.js';
import { buildFileTree, type FileTreeNode } from '../view/src/file-tree.js';
import { rmDirBestEffort } from './util.js';

function paths(nodes: FileTreeNode[]): string[] {
  return nodes.flatMap((node) => [
    node.path,
    ...(node.kind === 'directory' ? paths(node.children) : []),
  ]);
}

describe('sidebar directory order', () => {
  // @lat: [[lat.md/view/specs#View Tests#Builds a nested file tree#Uses authored index order]]
  it('orders pages and folders by their index and preserves incomplete entries', () => {
    const files = [
      'handbook.md',
      'aaa.md',
      'chapter10.md',
      'Chapter2.md',
      'zebra.md',
      'docs/docs.md',
      'docs/api.md',
      'docs/start.md',
      'docs/next.md',
      'docs/nested/nested.md',
      'docs/nested/z.md',
      'docs/nested/a.md',
      'constructor/page.md',
    ];
    const tree = buildFileTree(
      files,
      {
        '': ['docs', 'zebra', 'aaa', 'docs', 'missing'],
        docs: ['start.md', 'nested', 'api', 'start'],
        'docs/nested': ['z', 'a'],
      },
      'handbook.md',
    );
    expect(paths(tree)).toEqual([
      'handbook.md',
      'docs',
      'docs/docs.md',
      'docs/start.md',
      'docs/nested',
      'docs/nested/nested.md',
      'docs/nested/z.md',
      'docs/nested/a.md',
      'docs/api.md',
      'docs/next.md',
      'zebra.md',
      'aaa.md',
      'Chapter2.md',
      'chapter10.md',
      'constructor',
      'constructor/page.md',
    ]);
    expect(files[0]).toBe('handbook.md');
  });
});

describe('directory index navigation', () => {
  let projectRoot: string;
  let latDir: string;
  let store: ViewStore | undefined;

  function writeDocument(path: string, content: string): void {
    const absolute = join(latDir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lat-view-navigation-'));
    latDir = join(projectRoot, 'lat.md');
    writeDocument(
      'lat.md',
      '# Index\n\nAn early inline [[alpha]] link does not order the listing.\n\n- [[zeta|First page]] — Start here.\n- [[docs]] — Guides.\n- [[alpha]] — Reference.\n',
    );
    writeDocument('alpha.md', '# Alpha\n\nReference details.\n');
    writeDocument('zeta.md', '# Zeta\n\nGetting started.\n');
    writeDocument(
      'docs/docs.md',
      '# Docs\n\nDocumentation overview.\n\n- [[setup]] — Installation.\n- [[api]] — API reference.\n',
    );
    writeDocument('docs/setup.md', '# Setup\n\nInstall the project.\n');
    writeDocument(
      'docs/api.md',
      '# API\n\nAPI details.\n\n- [[alpha]] — A list in an ordinary page.\n',
    );
  });

  afterEach(async () => {
    await store?.close();
    store = undefined;
    rmDirBestEffort(projectRoot);
  });

  // @lat: [[lat.md/view/specs#View Tests#Builds a nested file tree#Shares directory order across live and exported views]]
  it('shares parsed index order with the sidebar, live refresh, and static export', async () => {
    store = await createViewStore(latDir, projectRoot, {
      git: false,
      watch: false,
    });
    const initial = store.getIndex();
    expect(initial.directoryOrder).toEqual({
      '': ['zeta', 'docs', 'alpha'],
      docs: ['setup', 'api'],
    });
    expect(paths(buildFileTree(initial.files, initial.directoryOrder))).toEqual(
      [
        'lat.md',
        'zeta.md',
        'docs',
        'docs/docs.md',
        'docs/setup.md',
        'docs/api.md',
        'alpha.md',
      ],
    );
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        activePath: 'lat.md',
        activeExternalTarget: null,
        errorCounts: initial.errorCounts,
        externalFiles: initial.externalFiles,
        files: initial.files,
        directoryOrder: initial.directoryOrder,
        entry: initial.entry,
        gitFiles: {},
        onNavigate: () => {},
      }),
    );
    expect(
      [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual([
      '/lat',
      '/zeta',
      '/docs/docs',
      '/docs/docs',
      '/docs/setup',
      '/docs/api',
      '/alpha',
    ]);
    expect(await checkIndex(latDir)).toEqual([]);

    const unchanged = store.snapshot.files.get('alpha.md');
    writeDocument(
      'lat.md',
      '# Index\n\nProject overview.\n\n- [[alpha]] — Reference.\n- [[docs]] — Guides.\n- [[zeta]] — Getting started.\n',
    );
    writeDocument(
      'docs/docs.md',
      '# Docs\n\nDocumentation overview.\n\n- [[api]] — API reference.\n- [[setup]] — Installation.\n',
    );
    await store.refresh(['lat.md/lat.md', 'lat.md/docs/docs.md']);
    expect(store.snapshot.files.get('alpha.md')).toBe(unchanged);
    const updated = store.getIndex();
    expect(updated.directoryOrder).toEqual({
      '': ['alpha', 'docs', 'zeta'],
      docs: ['api', 'setup'],
    });
    const expected = [
      'lat.md',
      'alpha.md',
      'docs',
      'docs/docs.md',
      'docs/api.md',
      'docs/setup.md',
      'zeta.md',
    ];
    expect(paths(buildFileTree(updated.files, updated.directoryOrder))).toEqual(
      expected,
    );

    const clientDir = join(projectRoot, 'client');
    mkdirSync(clientDir);
    writeFileSync(
      join(clientDir, 'index.html'),
      '<!doctype html><html><head></head><body></body></html>',
    );
    const output = join(projectRoot, 'site');
    await buildStaticView(
      { latDir, projectRoot, styler: plainStyler, mode: 'cli' },
      output,
      { clientDir },
    );
    const manifest = JSON.parse(
      readFileSync(join(output, 'data', 'manifest.json'), 'utf8'),
    ) as ViewStaticManifest;
    expect(manifest.index.directoryOrder).toEqual(updated.directoryOrder);
    expect(
      paths(buildFileTree(manifest.index.files, manifest.index.directoryOrder)),
    ).toEqual(expected);
  });

  // @lat: [[tests/check-index#Check Index#Detects missing entries]]
  it('rejects orphan pages omitted from root and subdirectory indexes', async () => {
    writeDocument(
      'lat.md',
      '# Index\n\nProject overview.\n\n- [[docs]] — Guides.\n- [[alpha]] — Reference.\n',
    );
    writeDocument(
      'docs/docs.md',
      '# Docs\n\nDocumentation overview.\n\n- [[api]] — API reference.\n',
    );
    const errors = await checkIndex(latDir);
    expect(errors).toHaveLength(2);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dir: 'lat.md/',
          message: expect.stringContaining('missing entries'),
          snippet: expect.stringContaining('[[zeta]]'),
        }),
        expect.objectContaining({
          dir: 'docs/',
          message: expect.stringContaining('missing entries'),
          snippet: expect.stringContaining('[[setup]]'),
        }),
      ]),
    );
  });
});
