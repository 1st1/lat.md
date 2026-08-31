import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  analyzeMarkdownFile,
  type MarkdownAnalysisTimings,
  type MarkdownFileAnalysis,
} from './markdown-analysis.js';
import { toPosix } from './walk.js';

/** Version of the persistent parser output and on-disk cache contract. */
export const PARSER_CACHE_VERSION = 1;

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

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function cacheIdentity(absolutePath: string, projectRoot: string): string {
  return toPosix(relative(projectRoot, absolutePath)).normalize('NFC');
}

function readablePath(identity: string): string {
  const normalized = identity
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return (normalized || 'markdown').slice(-120);
}

function cacheShard(absolutePath: string): string {
  const stem = basename(absolutePath, extname(absolutePath));
  const firstTwo = [...stem.toLowerCase()].slice(0, 2).join('');
  return firstTwo.replace(/[^a-z0-9]/g, '_') || '_';
}

/** Return the collision-safe, sharded cache path for one Markdown file. */
export function markdownAnalysisCachePath(
  latDir: string,
  projectRoot: string,
  absolutePath: string,
): string {
  const identity = cacheIdentity(absolutePath, projectRoot);
  const digest = sha1(identity);
  return join(
    latDir,
    '.cache',
    'parsed',
    cacheShard(absolutePath),
    `${digest}_${readablePath(identity)}`,
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
  serialized: string | null,
  contentHash: string,
  content: string,
  absolutePath: string,
  latDir: string,
  projectRoot: string,
): MarkdownFileAnalysis | null {
  if (!serialized) return null;
  const newline = serialized.indexOf('\n');
  if (
    newline < 0 ||
    serialized.slice(0, newline).trim() !==
      `v${PARSER_CACHE_VERSION}:${contentHash}`
  ) {
    return null;
  }

  try {
    const analysis = JSON.parse(
      serialized.slice(newline + 1),
    ) as MarkdownFileAnalysis;
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

async function optionalCacheRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
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
    ? optionalCacheRead(cachePath).then((serialized) => ({
        serialized,
        cacheReadMs: performance.now() - cacheStarted,
      }))
    : Promise.resolve({ serialized: null, cacheReadMs: 0 });
  const [{ content, readMs }, { serialized, cacheReadMs }] = await Promise.all([
    contentPromise,
    cachePromise,
  ]);
  const hashStarted = performance.now();
  const contentHash = sha1(content);
  const hashMs = performance.now() - hashStarted;
  const analysis = cache
    ? cachedAnalysis(
        serialized,
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

async function atomicCacheWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
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
    await atomicCacheWrite(
      prepared.cachePath,
      `v${PARSER_CACHE_VERSION}:${prepared.contentHash}\n${JSON.stringify(base)}\n`,
    );
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
): Promise<MarkdownFileAnalysis> {
  const prepared = await prepareMarkdownAnalysis(
    absolutePath,
    latDir,
    projectRoot,
    cache,
  );
  if (prepared.analysis) return prepared.analysis;
  return publishMarkdownAnalysis(
    prepared,
    analyzeMarkdownFile(absolutePath, prepared.content, latDir, projectRoot),
  );
}
