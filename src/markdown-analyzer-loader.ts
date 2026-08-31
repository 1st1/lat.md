import { performance } from 'node:perf_hooks';
import type { analyzeMarkdownFile } from './markdown-analysis.js';
import type { ParserImportObserver } from './parser-import.js';

/** Load the Markdown analyzer at the cache-miss boundary and report its cost. */
export async function loadMarkdownAnalyzer(
  onParserImport?: ParserImportObserver,
  detail?: string,
): Promise<typeof analyzeMarkdownFile> {
  const started = performance.now();
  const module = await import('./markdown-analysis.js');
  onParserImport?.({
    parser: 'Markdown analyzer',
    imported: true,
    durationMs: performance.now() - started,
    detail,
  });
  return module.analyzeMarkdownFile;
}
