import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ExternalDocumentParserRuntime,
  addExternalDocumentAliasAnchors,
  analyzeExternalDocument,
  analyzeExternalDocumentCached,
  externalDocumentAnalysisCachePath,
  findExternalDocumentSection,
  renderExternalDocument,
} from '../src/external-documents.js';
import { externalHtmlToDocumentTree } from '../src/view/markdown.js';
import { documentTreeToHtml } from './document-tree.js';
import { PARSER_CACHE_VERSION } from '../src/parser-cache.js';
import { rmDirBestEffort } from './util.js';

describe('external document formats', () => {
  const projects: string[] = [];

  afterEach(() => {
    for (const project of projects.splice(0)) rmDirBestEffort(project);
  });

  // @lat: [[tests/external-tests#External Sources#Document formats]]
  it('preserves section identities and safely renders document formats', async () => {
    const markdown = [
      '# Assert',
      '',
      'Assertions.',
      '',
      '## Class: `assert.AssertionError`',
      '',
      'Assertion errors.',
      '',
      '### `new assert.AssertionError(options)`',
      '',
      'Creates an assertion error.',
    ].join('\n');
    const markdownAnalysis = await analyzeExternalDocument(
      'assert.md',
      markdown,
    );
    expect(
      markdownAnalysis.sections.map(({ title, hierarchy }) => ({
        title,
        hierarchy,
      })),
    ).toEqual([
      { title: 'Assert', hierarchy: ['Assert'] },
      {
        title: 'Class: assert.AssertionError',
        hierarchy: ['Assert', 'Class: assert.AssertionError'],
      },
      {
        title: 'new assert.AssertionError(options)',
        hierarchy: [
          'Assert',
          'Class: assert.AssertionError',
          'new assert.AssertionError(options)',
        ],
      },
    ]);
    expect(
      findExternalDocumentSection(
        markdownAnalysis,
        'Class: assert.AssertionError',
      ),
    ).toMatchObject({ title: 'Class: assert.AssertionError' });

    const rst = [
      'Guide',
      '=====',
      '',
      'Pinned guide.',
      '',
      '.. _install:',
      '',
      'Installation',
      '------------',
      '',
      'Install it.',
      '',
      'Details',
      '~~~~~~~',
      '',
      'Nested details.',
    ].join('\n');
    const rstAnalysis = await analyzeExternalDocument('guide.rst', rst);
    expect(rstAnalysis.format).toBe('restructuredtext');
    expect(
      rstAnalysis.sections.map(({ title, depth }) => [title, depth]),
    ).toEqual([
      ['Guide', 1],
      ['Installation', 2],
      ['Details', 3],
    ]);
    expect(findExternalDocumentSection(rstAnalysis, 'install')).toMatchObject({
      title: 'Installation',
      startLine: 8,
      endLine: 16,
    });
    expect(
      findExternalDocumentSection(rstAnalysis, 'Guide#Installation#Details'),
    ).toMatchObject({ title: 'Details' });

    const asciidoc = [
      '[[Guide_Root]]',
      '= Guide',
      '',
      'Pinned guide.',
      '',
      '[#install]',
      '== Installation',
      '',
      'Install it.',
      '',
      '=== Details',
      '',
      'Nested details.',
      '',
      '[source, c]',
      '-----',
      'int main(void) { return 0; }',
      '----',
      '',
      '[[Late_Section]]',
      '== Late Section',
      '',
      'Still parsed after a legacy listing block.',
    ].join('\n');
    const asciidocAnalysis = await analyzeExternalDocument(
      'guide.asciidoc',
      asciidoc,
    );
    expect(asciidocAnalysis).toMatchObject({
      format: 'asciidoc',
      title: 'Guide',
    });
    expect(
      asciidocAnalysis.sections.map(({ title, depth, anchor }) => ({
        title,
        depth,
        anchor,
      })),
    ).toEqual([
      { title: 'Guide', depth: 1, anchor: 'Guide_Root' },
      { title: 'Installation', depth: 2, anchor: 'install' },
      { title: 'Details', depth: 3, anchor: '_details' },
      { title: 'Late Section', depth: 2, anchor: 'Late_Section' },
    ]);
    expect(
      findExternalDocumentSection(asciidocAnalysis, 'Guide_Root'),
    ).toMatchObject({ title: 'Guide', startLine: 1 });
    expect(
      findExternalDocumentSection(asciidocAnalysis, 'install'),
    ).toMatchObject({
      title: 'Installation',
      startLine: 7,
      endLine: 20,
    });
    expect(
      findExternalDocumentSection(asciidocAnalysis, '_details'),
    ).toMatchObject({ title: 'Details' });
    expect(
      findExternalDocumentSection(asciidocAnalysis, 'Late_Section'),
    ).toMatchObject({ title: 'Late Section', startLine: 21 });

    const rstHtml = documentTreeToHtml(
      addExternalDocumentAliasAnchors(
        externalHtmlToDocumentTree(
          await renderExternalDocument('restructuredtext', rst),
        ),
        rstAnalysis,
      ),
    );
    const asciidocHtml = documentTreeToHtml(
      externalHtmlToDocumentTree(
        await renderExternalDocument('asciidoc', asciidoc),
      ),
    );
    expect(rstHtml).toContain('<h2 id="installation">');
    expect(rstHtml).toContain('<span id="install" aria-hidden="true"></span>');
    expect(rstHtml).toContain('Nested details.');
    expect(asciidocHtml).toContain('<h1 id="Guide_Root">Guide</h1>');
    expect(asciidocHtml).toContain('<h2 id="install">Installation</h2>');
    expect(asciidocHtml).toContain('Nested details.');
    expect(asciidocHtml).toContain('<h2 id="Late_Section">Late Section</h2>');

    const unsafe = documentTreeToHtml(
      externalHtmlToDocumentTree(
        '<h1 id="safe">Safe</h1><script>alert(1)</script>',
      ),
    );
    expect(unsafe).toContain('<h1 id="safe">Safe</h1>');
    expect(unsafe).not.toContain('<script');
  });

  // @lat: [[tests/external-tests#External Sources#Persistent document analysis cache]]
  it('persists validated analysis for every external document format', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lat-external-doc-cache-'));
    projects.push(root);
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir);
    const documents = [
      {
        path: 'guide.md',
        content: '# Guide\n\nPinned guide.\n\n## Navigation\n\nNavigate.\n',
        format: 'markdown',
      },
      {
        path: 'guide.rst',
        content: 'Guide\n=====\n\nPinned guide.\n',
        format: 'restructuredtext',
      },
      {
        path: 'guide.adoc',
        content: '= Guide\n\nPinned guide.\n',
        format: 'asciidoc',
      },
    ] as const;

    for (const document of documents) {
      const identity = `@external/upstream/${document.path}`;
      const cold = await analyzeExternalDocumentCached(
        document.path,
        document.content,
        latDir,
        { identity, runtime: new ExternalDocumentParserRuntime() },
      );
      expect(cold.document.format).toBe(document.format);
      expect(cold.timings.cacheStatus).toBe('miss');

      const cachePath = externalDocumentAnalysisCachePath(latDir, identity);
      expect(readFileSync(cachePath, 'utf8')).toMatch(
        new RegExp(`^v${PARSER_CACHE_VERSION}:[a-f0-9]{40}\\n`),
      );

      const warm = await analyzeExternalDocumentCached(
        document.path,
        document.content,
        latDir,
        { identity, runtime: new ExternalDocumentParserRuntime() },
      );
      expect(warm.document).toEqual(cold.document);
      expect(warm.timings).toMatchObject({ cacheStatus: 'hit', parseMs: 0 });
    }

    const markdown = documents[0];
    const identity = `@external/upstream/${markdown.path}`;
    const cachePath = externalDocumentAnalysisCachePath(latDir, identity);
    writeFileSync(
      cachePath,
      readFileSync(cachePath, 'utf8').replace(
        /^v\d+:/,
        `v${PARSER_CACHE_VERSION + 1}:`,
      ),
    );
    const invalidVersion = await analyzeExternalDocumentCached(
      markdown.path,
      markdown.content,
      latDir,
      { identity, runtime: new ExternalDocumentParserRuntime() },
    );
    expect(invalidVersion.timings.cacheStatus).toBe('miss');

    const changed = await analyzeExternalDocumentCached(
      markdown.path,
      `${markdown.content}\n## Changed\n\nChanged content.\n`,
      latDir,
      { identity, runtime: new ExternalDocumentParserRuntime() },
    );
    expect(changed.timings.cacheStatus).toBe('miss');
    expect(changed.document.sections.at(-1)?.title).toBe('Changed');

    const header = readFileSync(cachePath, 'utf8').split('\n', 1)[0];
    writeFileSync(cachePath, `${header}\n{"path":"wrong"}\n`);
    const recovered = await analyzeExternalDocumentCached(
      markdown.path,
      `${markdown.content}\n## Changed\n\nChanged content.\n`,
      latDir,
      { identity, runtime: new ExternalDocumentParserRuntime() },
    );
    expect(recovered.timings.cacheStatus).toBe('miss');
    expect(recovered.document.sections.at(-1)?.title).toBe('Changed');
  });
});
