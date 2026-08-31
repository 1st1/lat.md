import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  buildFileIndex,
  buildSectionSlugIndex,
  flattenSections,
  resolveRef,
  type Ref,
  type Section,
  type SectionSlugIndex,
} from './lattice.js';
import {
  analyzeMarkdownFile,
  type MarkdownFileAnalysis,
} from './markdown-analysis.js';
import {
  prepareMarkdownAnalysis,
  publishMarkdownAnalysis,
  type PreparedMarkdownAnalysis,
} from './markdown-analysis-cache.js';
import type {
  MarkdownWorkerResponse,
  MarkdownWorkerTask,
} from './markdown-analysis-worker.js';
import { walkEntries } from './walk.js';
import { scanCodeRefs, type ScanResult } from './code-refs.js';
import {
  SourceParserRuntime,
  type ResolveSourceSymbolOptions,
} from './source-parser.js';
import {
  createExternalResolver,
  type ExternalResolver,
} from './external-sources.js';

export type MarkdownAnalysisExecutor = 'inline' | 'workers' | 'auto';

export type MarkdownProjectAnalysis = {
  latDir: string;
  projectRoot: string;
  entries: string[];
  markdownFiles: string[];
  files: ReadonlyMap<string, MarkdownFileAnalysis>;
  filesByAbsolutePath: ReadonlyMap<string, MarkdownFileAnalysis>;
  allSections: Section[];
  sections: Section[];
  sectionById: ReadonlyMap<string, Section>;
  sectionIds: ReadonlySet<string>;
  fileIndex: Map<string, string[]>;
  slugIndex: SectionSlugIndex;
  wikiRefs: readonly Ref[];
  outgoingRefsBySection: ReadonlyMap<string, readonly Ref[]>;
  refsByTarget: ReadonlyMap<string, readonly Ref[]>;
  incomingRefsBySection: ReadonlyMap<string, readonly Ref[]>;
};

export type AnalyzeMarkdownProjectOptions = {
  executor?: MarkdownAnalysisExecutor;
  maxWorkers?: number;
  cache?: boolean;
  onFileAnalyzed?: (analysis: MarkdownFileAnalysis) => void;
};

async function analyzeInline(
  files: PreparedMarkdownAnalysis[],
  latDir: string,
  projectRoot: string,
): Promise<MarkdownFileAnalysis[]> {
  return Promise.all(
    files.map((file) =>
      publishMarkdownAnalysis(
        file,
        analyzeMarkdownFile(
          file.absolutePath,
          file.content,
          latDir,
          projectRoot,
        ),
      ),
    ),
  );
}

function runWorkerTask(
  worker: Worker,
  task: MarkdownWorkerTask,
): Promise<MarkdownFileAnalysis> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: MarkdownWorkerResponse) => {
      cleanup();
      if ('error' in response) {
        reject(
          new Error(
            `Failed to analyze ${task.absolutePath}: ${response.error}`,
          ),
        );
      } else {
        resolve(response.analysis);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number) => {
      cleanup();
      reject(
        new Error(
          `Markdown analysis worker exited with code ${code} while reading ${task.absolutePath}`,
        ),
      );
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.postMessage(task);
  });
}

async function analyzeWithWorkers(
  files: PreparedMarkdownAnalysis[],
  latDir: string,
  projectRoot: string,
  maxWorkers: number | undefined,
): Promise<MarkdownFileAnalysis[]> {
  const workerCount = Math.max(
    1,
    Math.min(
      files.length,
      maxWorkers ?? 10,
      Math.max(1, availableParallelism() - 1),
    ),
  );
  const workers = Array.from({ length: workerCount }, () => {
    const sourceRuntime = import.meta.url.endsWith('.ts');
    return new Worker(
      new URL(
        sourceRuntime
          ? './markdown-analysis-worker.ts'
          : './markdown-analysis-worker.js',
        import.meta.url,
      ),
      {
        execArgv: sourceRuntime
          ? ['--import', 'tsx']
          : process.execArgv.filter(
              (argument) => !argument.startsWith('--input-type'),
            ),
      },
    );
  });
  const analyses = new Array<MarkdownFileAnalysis>(files.length);
  let next = 0;
  try {
    await Promise.all(
      workers.map(async (worker) => {
        while (true) {
          const id = next++;
          if (id >= files.length) return;
          const file = files[id];
          analyses[id] = await runWorkerTask(worker, {
            id,
            absolutePath: file.absolutePath,
            content: file.content,
            latDir,
            projectRoot,
          });
        }
      }),
    );
    return Promise.all(
      analyses.map((analysis, index) =>
        publishMarkdownAnalysis(files[index], analysis),
      ),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

/** Read and analyze every Markdown file into one immutable command snapshot. */
export async function analyzeMarkdownProject(
  latDir: string,
  projectRoot: string,
  options: AnalyzeMarkdownProjectOptions = {},
): Promise<MarkdownProjectAnalysis> {
  const entries = await walkEntries(latDir);
  const markdownFiles = entries
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => join(latDir, entry));
  const prepared = await Promise.all(
    markdownFiles.map((absolutePath) =>
      prepareMarkdownAnalysis(
        absolutePath,
        latDir,
        projectRoot,
        options.cache !== false,
      ),
    ),
  );
  const analyses = new Array<MarkdownFileAnalysis>(markdownFiles.length);
  const misses: PreparedMarkdownAnalysis[] = [];
  const missIndexes: number[] = [];
  for (const [index, file] of prepared.entries()) {
    if (file.analysis) analyses[index] = file.analysis;
    else {
      misses.push(file);
      missIndexes.push(index);
    }
  }
  const executor =
    options.executor === 'auto' || options.executor === undefined
      ? misses.length >= 8
        ? 'workers'
        : 'inline'
      : options.executor;
  const parsed =
    executor === 'workers' && misses.length > 1
      ? await analyzeWithWorkers(
          misses,
          latDir,
          projectRoot,
          options.maxWorkers,
        )
      : await analyzeInline(misses, latDir, projectRoot);
  for (const [index, analysis] of parsed.entries()) {
    analyses[missIndexes[index]] = analysis;
  }

  const files = new Map<string, MarkdownFileAnalysis>();
  const filesByAbsolutePath = new Map<string, MarkdownFileAnalysis>();
  for (const analysis of analyses) {
    files.set(analysis.path, analysis);
    filesByAbsolutePath.set(analysis.absolutePath, analysis);
    options.onFileAnalyzed?.(analysis);
  }
  const allSections = analyses.flatMap((analysis) => analysis.sections);
  const sections = flattenSections(allSections);
  const sectionById = new Map(
    sections.map((section) => [section.id.toLowerCase(), section]),
  );
  const sectionIds = new Set(sectionById.keys());
  const fileIndex = buildFileIndex(allSections);
  const slugIndex = buildSectionSlugIndex(allSections);
  const wikiRefs = analyses.flatMap((analysis) => analysis.wikiRefs);
  const outgoingRefsBySection = new Map<string, Ref[]>();
  const refsByTarget = new Map<string, Ref[]>();
  const incomingRefsBySection = new Map<string, Ref[]>();
  const append = (index: Map<string, Ref[]>, key: string, ref: Ref) => {
    const refs = index.get(key);
    if (refs) refs.push(ref);
    else index.set(key, [ref]);
  };

  for (const ref of wikiRefs) {
    const from = ref.fromSection.toLowerCase();
    const target = ref.target.toLowerCase();
    append(outgoingRefsBySection, from, ref);
    append(refsByTarget, target, ref);

    const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
    if (!resolved.ambiguous) {
      const resolvedId = resolved.resolved.toLowerCase();
      if (sectionIds.has(resolvedId)) {
        append(incomingRefsBySection, resolvedId, ref);
      }
    }
  }

  return {
    latDir,
    projectRoot,
    entries,
    markdownFiles,
    files,
    filesByAbsolutePath,
    allSections,
    sections,
    sectionById,
    sectionIds,
    fileIndex,
    slugIndex,
    wikiRefs,
    outgoingRefsBySection,
    refsByTarget,
    incomingRefsBySection,
  };
}

/** Lazy request-scoped owner for one immutable project analysis. */
export class MarkdownProjectSession {
  private analysisPromise?: Promise<MarkdownProjectAnalysis>;
  private codeRefsPromise?: Promise<ScanResult>;
  private externalPromise?: Promise<ExternalResolver>;
  private readonly sourceParserRuntime = new SourceParserRuntime();

  constructor(
    readonly latDir: string,
    readonly projectRoot: string,
    readonly options: AnalyzeMarkdownProjectOptions = {},
  ) {}

  analysis(): Promise<MarkdownProjectAnalysis> {
    this.analysisPromise ??= analyzeMarkdownProject(
      this.latDir,
      this.projectRoot,
      this.options,
    );
    return this.analysisPromise;
  }

  codeRefs(): Promise<ScanResult> {
    this.codeRefsPromise ??= scanCodeRefs(this.projectRoot);
    return this.codeRefsPromise;
  }

  external(): Promise<ExternalResolver> {
    this.externalPromise ??= (async () => {
      const resolver = await createExternalResolver(
        this.latDir,
        this.projectRoot,
      );
      await resolver.reconcile();
      return resolver;
    })();
    return this.externalPromise;
  }

  sourceSymbolOptions(): ResolveSourceSymbolOptions {
    return {
      latDir: this.latDir,
      runtime: this.sourceParserRuntime,
    };
  }
}

type AnalysisContext = {
  latDir: string;
  projectRoot: string;
  analysis?: MarkdownProjectSession;
};

/** Reuse one lazy project snapshot throughout a CLI or MCP request. */
export function commandProjectAnalysis(
  context: AnalysisContext,
): Promise<MarkdownProjectAnalysis> {
  return commandProjectSession(context).analysis();
}

/** Obtain the complete lazy request session for nested semantic operations. */
export function commandProjectSession(
  context: AnalysisContext,
): MarkdownProjectSession {
  context.analysis ??= new MarkdownProjectSession(
    context.latDir,
    context.projectRoot,
  );
  return context.analysis;
}
