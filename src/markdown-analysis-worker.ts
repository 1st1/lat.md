import { parentPort } from 'node:worker_threads';
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
    }
  | { id: number; error: string };

if (!parentPort)
  throw new Error('Markdown analysis worker needs a parent port');

async function loadAnalyzer(): Promise<typeof analyzeMarkdownFile> {
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
  return module.analyzeMarkdownFile as typeof analyzeMarkdownFile;
}

const analyzerPromise = loadAnalyzer();

parentPort.on('message', async (task: MarkdownWorkerTask) => {
  try {
    const analyzeMarkdownFile = await analyzerPromise;
    const analysis = analyzeMarkdownFile(
      task.absolutePath,
      task.content,
      task.latDir,
      task.projectRoot,
    );
    parentPort!.postMessage({ id: task.id, analysis });
  } catch (error) {
    parentPort!.postMessage({
      id: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
