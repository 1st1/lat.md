import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExternalDocumentParserRuntime,
  analyzeExternalDocumentCached,
  externalDocumentAnalysisCachePath,
  type ExternalDocumentAnalysis,
} from '../src/external-documents.js';
import { markdownAnalysisCachePath } from '../src/markdown-analysis-cache.js';
import { hashParserContent, writeParsedCache } from '../src/parser-cache.js';
import { analyzeMarkdownProject } from '../src/project-analysis.js';

vi.mock('../src/markdown-analysis.js', () => {
  throw new Error('Markdown analyzer loaded on a warm cache path');
});
vi.mock('rst-compiler', () => {
  throw new Error('reStructuredText parser loaded on a warm cache path');
});
vi.mock('@asciidoctor/core', () => {
  throw new Error('AsciiDoc parser loaded on a warm cache path');
});

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function zeroTimings() {
  return {
    readMs: 0,
    hashMs: 0,
    cacheReadMs: 0,
    cacheWriteMs: 0,
    cacheStatus: 'miss' as const,
    parseMs: 0,
    sectionsMs: 0,
    refsMs: 0,
    linksMs: 0,
    paragraphsMs: 0,
    frontmatterMs: 0,
    indexEntriesMs: 0,
    diagnosticsMs: 0,
  };
}

describe('lazy parser imports', () => {
  // @lat: [[tests/analysis-tests#Keeps format parsers off warm cache paths]]
  it('hydrates local and external analyses without loading format parsers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lat-lazy-parsers-'));
    temporaryRoots.push(root);
    const latDir = join(root, 'lat.md');
    const absolutePath = join(latDir, 'lat.md');
    const content = '# Cached\n\nAlready analyzed.\n';
    await mkdir(latDir);
    await writeFile(absolutePath, content);

    await writeParsedCache(
      markdownAnalysisCachePath(latDir, root, absolutePath),
      hashParserContent(content),
      {
        absolutePath,
        content,
        path: 'lat.md',
        projectPath: 'lat.md/lat.md',
        frontmatter: {},
        sections: [
          {
            id: 'lat.md/lat#Cached',
            heading: 'Cached',
            depth: 1,
            file: 'lat.md/lat',
            filePath: 'lat.md/lat.md',
            children: [],
            startLine: 1,
            endLine: 3,
            firstParagraph: 'Already analyzed.',
            githubSlug: 'cached',
          },
        ],
        headingTitles: ['Cached'],
        wikiRefs: [],
        paragraphs: [],
        markdownLinks: [],
        validationLinks: [],
        indexEntries: [],
        diagnostics: [],
        timings: zeroTimings(),
      },
    );

    const project = await analyzeMarkdownProject(latDir, root, {
      executor: 'inline',
    });
    expect(project.files.get('lat.md')?.timings.cacheStatus).toBe('hit');
    expect(project.sections.map((section) => section.heading)).toEqual([
      'Cached',
    ]);

    const externalDocuments: Array<{
      path: string;
      content: string;
      document: ExternalDocumentAnalysis;
    }> = [
      {
        path: 'guide.md',
        content: '# Guide\n',
        document: { format: 'markdown', title: 'Guide', sections: [] },
      },
      {
        path: 'guide.rst',
        content: 'Guide\n=====\n',
        document: {
          format: 'restructuredtext',
          title: 'Guide',
          sections: [],
        },
      },
      {
        path: 'guide.adoc',
        content: '= Guide\n',
        document: { format: 'asciidoc', title: 'Guide', sections: [] },
      },
    ];

    for (const external of externalDocuments) {
      const identity = `@external/upstream/${external.path}`;
      await writeParsedCache(
        externalDocumentAnalysisCachePath(latDir, identity),
        hashParserContent(external.content),
        { path: identity, document: external.document },
      );
      const analysis = await analyzeExternalDocumentCached(
        external.path,
        external.content,
        latDir,
        {
          identity,
          runtime: new ExternalDocumentParserRuntime(),
        },
      );
      expect(analysis.timings.cacheStatus).toBe('hit');
      expect(analysis.document).toEqual(external.document);
    }
  });
});
