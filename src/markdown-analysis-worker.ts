import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import type {
  analyzeMarkdownFile,
  MarkdownFileAnalysis,
} from './markdown-analysis.js';

export type MarkdownWorkerTask = {
  id: number;
  absolutePath: string;
  content: string;
  latDir: string;
  projectRoot: string;
};

export type MarkdownWorkerResponse =
  | {
      id: number;
      analysis: MarkdownFileAnalysis;
      importMs?: number;
    }
  | { id: number; error: string };

if (!parentPort)
  throw new Error('Markdown analysis worker needs a parent port');

async function loadAnalyzer(): Promise<{
  analyzeMarkdownFile: typeof analyzeMarkdownFile;
  importMs: number;
}> {
  const started = performance.now();
  const sourceRuntime = import.meta.url.endsWith('.ts');
  const moduleUrl = new URL(
    sourceRuntime ? './markdown-analysis.ts' : './markdown-analysis.js',
    import.meta.url,
  ).href;
  const module = sourceRuntime
    ? await import('tsx/esm/api').then(({ tsImport }) =>
        tsImport(moduleUrl, import.meta.url),
      )
    : await import(moduleUrl);
  return {
    analyzeMarkdownFile:
      module.analyzeMarkdownFile as typeof analyzeMarkdownFile,
    importMs: performance.now() - started,
  };
}

const analyzerPromise = loadAnalyzer();
let importReported = false;

parentPort.on('message', async (task: MarkdownWorkerTask) => {
  try {
    const loaded = await analyzerPromise;
    const importMs = importReported ? undefined : loaded.importMs;
    importReported = true;
    const analysis = loaded.analyzeMarkdownFile(
      task.absolutePath,
      task.content,
      task.latDir,
      task.projectRoot,
    );
    parentPort!.postMessage({ id: task.id, analysis, importMs });
  } catch (error) {
    parentPort!.postMessage({
      id: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
