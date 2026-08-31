import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  MarkdownAnalysisTimings,
  MarkdownFileAnalysis,
} from './markdown-analysis.js';
import {
  PARSER_CACHE_VERSION,
  hashParserContent,
  parsedCachePath,
  parserCacheIdentity,
  readParsedCache,
  writeParsedCache,
  type ParsedCacheEntry,
} from './parser-cache.js';
import { toPosix } from './path.js';
import { loadMarkdownAnalyzer } from './markdown-analyzer-loader.js';
import type { ParserImportObserver } from './parser-import.js';

export { PARSER_CACHE_VERSION } from './parser-cache.js';

export type MarkdownAnalysisCacheStatus = 'disabled' | 'hit' | 'miss';

export type PreparedMarkdownAnalysis = {
  absolutePath: string;
  cachePath: string;
  content: string;
  contentHash: string;
  analysis?: MarkdownFileAnalysis;
  timings: Pick<
    MarkdownAnalysisTimings,
    'readMs' | 'hashMs' | 'cacheReadMs' | 'cacheStatus'
  >;
};

/** Return the collision-safe, sharded cache path for one Markdown file. */
export function markdownAnalysisCachePath(
  latDir: string,
  projectRoot: string,
  absolutePath: string,
): string {
  return parsedCachePath(
    latDir,
    parserCacheIdentity(absolutePath, projectRoot),
  );
}

function emptyTimings(
  values: Pick<
    MarkdownAnalysisTimings,
    'readMs' | 'hashMs' | 'cacheReadMs' | 'cacheStatus'
  >,
): MarkdownAnalysisTimings {
  return {
    ...values,
    cacheWriteMs: 0,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cachedAnalysis(
  entry: ParsedCacheEntry | null,
  contentHash: string,
  content: string,
  absolutePath: string,
  latDir: string,
  projectRoot: string,
): MarkdownFileAnalysis | null {
  if (
    !entry ||
    entry.version !== PARSER_CACHE_VERSION ||
    entry.contentHash !== contentHash
  ) {
    return null;
  }

  try {
    const analysis = entry.value as MarkdownFileAnalysis;
    const expectedPath = toPosix(relative(latDir, absolutePath));
    const expectedProjectPath = toPosix(relative(projectRoot, absolutePath));
    if (
      !isRecord(analysis) ||
      analysis.content !== content ||
      analysis.path !== expectedPath ||
      analysis.projectPath !== expectedProjectPath ||
      !isRecord(analysis.frontmatter) ||
      !Array.isArray(analysis.sections) ||
      !Array.isArray(analysis.headingTitles) ||
      !Array.isArray(analysis.wikiRefs) ||
      !Array.isArray(analysis.paragraphs) ||
      !Array.isArray(analysis.markdownLinks) ||
      !Array.isArray(analysis.validationLinks) ||
      !Array.isArray(analysis.indexEntries) ||
      !Array.isArray(analysis.diagnostics)
    ) {
      return null;
    }
    return { ...analysis, absolutePath };
  } catch {
    return null;
  }
}

/** Read, hash, and attempt to hydrate one Markdown file from persistent cache. */
export async function prepareMarkdownAnalysis(
  absolutePath: string,
  latDir: string,
  projectRoot: string,
  cache = true,
): Promise<PreparedMarkdownAnalysis> {
  const cachePath = markdownAnalysisCachePath(
    latDir,
    projectRoot,
    absolutePath,
  );
  const readStarted = performance.now();
  const contentPromise = readFile(absolutePath, 'utf8').then((content) => ({
    content,
    readMs: performance.now() - readStarted,
  }));
  const cacheStarted = performance.now();
  const cachePromise = cache
    ? readParsedCache(cachePath).then((entry) => ({
        entry,
        cacheReadMs: performance.now() - cacheStarted,
      }))
    : Promise.resolve({ entry: null, cacheReadMs: 0 });
  const [{ content, readMs }, { entry, cacheReadMs }] = await Promise.all([
    contentPromise,
    cachePromise,
  ]);
  const hashStarted = performance.now();
  const contentHash = hashParserContent(content);
  const hashMs = performance.now() - hashStarted;
  const analysis = cache
    ? cachedAnalysis(
        entry,
        contentHash,
        content,
        absolutePath,
        latDir,
        projectRoot,
      )
    : null;
  const timings = {
    readMs,
    hashMs,
    cacheReadMs,
    cacheStatus: cache ? (analysis ? 'hit' : 'miss') : 'disabled',
  } satisfies PreparedMarkdownAnalysis['timings'];

  return {
    absolutePath,
    cachePath,
    content,
    contentHash,
    analysis: analysis
      ? { ...analysis, timings: emptyTimings(timings) }
      : undefined,
    timings,
  };
}

/** Attach I/O timings and best-effort publish one newly parsed analysis. */
export async function publishMarkdownAnalysis(
  prepared: PreparedMarkdownAnalysis,
  analysis: MarkdownFileAnalysis,
): Promise<MarkdownFileAnalysis> {
  const base = {
    ...analysis,
    timings: {
      ...analysis.timings,
      ...prepared.timings,
      cacheWriteMs: 0,
    },
  };
  if (prepared.timings.cacheStatus === 'disabled') return base;

  const started = performance.now();
  try {
    await writeParsedCache(prepared.cachePath, prepared.contentHash, base);
  } catch {
    // The cache is a disposable optimization; analysis must work read-only.
  }
  base.timings.cacheWriteMs = performance.now() - started;
  return base;
}

/** Analyze one path through the same persistent cache used by project runs. */
export async function analyzeMarkdownPath(
  absolutePath: string,
  latDir: string,
  projectRoot: string,
  cache = true,
  onParserImport?: ParserImportObserver,
): Promise<MarkdownFileAnalysis> {
  const prepared = await prepareMarkdownAnalysis(
    absolutePath,
    latDir,
    projectRoot,
    cache,
  );
  const detail = toPosix(relative(latDir, absolutePath));
  if (prepared.analysis) {
    onParserImport?.({
      parser: 'Markdown analyzer',
      imported: false,
      durationMs: 0,
      detail: `${detail} cached`,
    });
    return prepared.analysis;
  }
  const analyzeMarkdownFile = await loadMarkdownAnalyzer(
    onParserImport,
    detail,
  );
  return publishMarkdownAnalysis(
    prepared,
    analyzeMarkdownFile(absolutePath, prepared.content, latDir, projectRoot),
  );
}
