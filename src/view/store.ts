import { watch as watchFiles, type FSWatcher } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { LAT_REF_RE, scanCodeRefs, type CodeRef } from '../code-refs.js';
import {
  listLatticeFiles,
  parseFrontmatter,
  type Section,
} from '../lattice.js';
import { SOURCE_EXTENSIONS } from '../source-parser.js';
import { toPosix } from '../walk.js';
import { renderMarkdown } from './markdown.js';
import { buildViewDiagnostics } from './diagnostics.js';
import type {
  ViewDocument,
  ViewDocumentError,
  ViewIndex,
  ViewProjectChange,
  ViewSourceDocument,
} from './protocol.js';
import {
  createMarkdownWikiLinkResolver,
  getViewSource,
  ViewDocumentNotFoundError,
} from './repository.js';
import {
  buildViewReferenceIndex,
  parseViewMarkdownFile,
  renderSectionBackReferences,
  type ViewCodeReferenceFile,
  type ViewParsedMarkdownFile,
  type ViewReferenceIndex,
} from './references.js';

const DEFAULT_DEBOUNCE_MS = 75;

export type ViewProjectSnapshot = {
  generation: number;
  markdownGeneration: number;
  files: ReadonlyMap<string, ViewParsedMarkdownFile>;
  allSections: Section[];
  references: ViewReferenceIndex;
  diagnostics: ReadonlyMap<string, readonly ViewDocumentError[]>;
  index: ViewIndex;
};

export type ViewStoreOptions = {
  debounceMs?: number;
  watch?: boolean;
};

type ViewStoreListener = (change: ViewProjectChange) => void;

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  );
}

function projectPath(projectRoot: string, path: string): string {
  const normalized = isAbsolute(path) ? relative(projectRoot, path) : path;
  return toPosix(normalized).replace(/^\.\//, '');
}

function sourcePath(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase());
}

function obviouslyIgnoredCodePath(path: string, latPath: string): boolean {
  const parts = path.split('/');
  return (
    path === latPath ||
    path.startsWith(`${latPath}/`) ||
    parts.includes('.git') ||
    parts.includes('.claude') ||
    parts.includes('node_modules')
  );
}

function codeRefsFromContent(path: string, content: string): CodeRef[] {
  const refs: CodeRef[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    LAT_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LAT_REF_RE.exec(lines[index])) !== null) {
      refs.push({ target: match[1], file: path, line: index + 1 });
    }
  }
  return refs;
}

async function loadCodeReferenceFiles(
  projectRoot: string,
  refs: CodeRef[],
): Promise<Map<string, ViewCodeReferenceFile>> {
  const refsByFile = new Map<string, CodeRef[]>();
  for (const ref of refs) {
    const path = toPosix(ref.file);
    const fileRefs = refsByFile.get(path) ?? [];
    fileRefs.push({ ...ref, file: path });
    refsByFile.set(path, fileRefs);
  }

  const files = new Map<string, ViewCodeReferenceFile>();
  await Promise.all(
    [...refsByFile].map(async ([path, fileRefs]) => {
      try {
        const content = await readFile(resolve(projectRoot, path), 'utf8');
        files.set(path, { path, lines: content.split('\n'), refs: fileRefs });
      } catch {
        // A file may disappear between the project scan and this read.
      }
    }),
  );
  return files;
}

async function scanCodeState(projectRoot: string): Promise<{
  files: Map<string, ViewCodeReferenceFile>;
  scope: Set<string>;
}> {
  const scan = await scanCodeRefs(projectRoot);
  const scope = new Set(
    scan.files.map((path) => projectPath(projectRoot, path)),
  );
  return {
    files: await loadCodeReferenceFiles(projectRoot, scan.refs),
    scope,
  };
}

function viewIndex(
  latDir: string,
  paths: string[],
  diagnostics: ReadonlyMap<string, readonly ViewDocumentError[]>,
): ViewIndex {
  const files = [...paths].sort();
  const directoryName = basename(latDir);
  const indexName = directoryName.endsWith('.md')
    ? directoryName
    : `${directoryName}.md`;
  return {
    files,
    entry: files.includes(indexName) ? indexName : (files[0] ?? ''),
    errorCounts: Object.fromEntries(
      [...diagnostics]
        .filter(([, errors]) => errors.length > 0)
        .map(([path, errors]) => [path, errors.length]),
    ),
  };
}

async function buildSnapshot(
  latDir: string,
  projectRoot: string,
  markdownFiles: Map<string, ViewParsedMarkdownFile>,
  codeFiles: Map<string, ViewCodeReferenceFile>,
  generation: number,
  markdownGeneration: number,
): Promise<ViewProjectSnapshot> {
  const files = new Map(
    [...markdownFiles].sort(([left], [right]) => left.localeCompare(right)),
  );
  const allSections = [...files.values()].flatMap((file) => file.sections);
  const diagnostics = await buildViewDiagnostics(
    files.values(),
    codeFiles.values(),
    allSections,
    projectRoot,
  );
  return {
    generation,
    markdownGeneration,
    files,
    allSections,
    references: buildViewReferenceIndex(
      files.values(),
      codeFiles.values(),
      allSections,
    ),
    diagnostics,
    index: viewIndex(latDir, [...files.keys()], diagnostics),
  };
}

/** Own the immutable, incrementally refreshed project snapshot for `lat ui`. */
export class ViewStore {
  private snapshotValue: ViewProjectSnapshot;
  private codeFiles: Map<string, ViewCodeReferenceFile>;
  private codeScope: Set<string>;
  private ignoredCodePaths = new Set<string>();
  private listeners = new Set<ViewStoreListener>();
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private refreshTail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    readonly latDir: string,
    readonly projectRoot: string,
    private readonly realLatDir: string,
    snapshot: ViewProjectSnapshot,
    codeFiles: Map<string, ViewCodeReferenceFile>,
    codeScope: Set<string>,
    private readonly options: ViewStoreOptions,
  ) {
    this.snapshotValue = snapshot;
    this.codeFiles = codeFiles;
    this.codeScope = codeScope;
  }

  get snapshot(): ViewProjectSnapshot {
    return this.snapshotValue;
  }

  get markdownGeneration(): number {
    return this.snapshotValue.markdownGeneration;
  }

  startWatching(): void {
    if (this.options.watch === false || this.watcher) return;
    try {
      this.watcher = watchFiles(
        this.projectRoot,
        { recursive: true },
        (_event, filename) => this.scheduleRefresh(filename?.toString() ?? ''),
      );
      this.watcher.on('error', (error) => {
        process.stderr.write(`lat ui watcher: ${error.message}\n`);
      });
    } catch (error) {
      process.stderr.write(`lat ui watcher: ${(error as Error).message}\n`);
    }
  }

  subscribe(listener: ViewStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getIndex(): ViewIndex {
    return this.snapshotValue.index;
  }

  async getDocument(requestedPath: string): Promise<ViewDocument> {
    if (
      !requestedPath ||
      requestedPath.includes('\\') ||
      isAbsolute(requestedPath) ||
      !requestedPath.toLowerCase().endsWith('.md')
    ) {
      throw new ViewDocumentNotFoundError('Markdown document not found');
    }
    const snapshot = this.snapshotValue;
    const file = snapshot.files.get(requestedPath);
    if (!file) {
      throw new ViewDocumentNotFoundError('Markdown document not found');
    }
    const resolver = await createMarkdownWikiLinkResolver(
      this.latDir,
      requestedPath,
      snapshot.allSections,
    );
    const rendered = await renderMarkdown(
      file.content,
      requestedPath,
      resolver,
      { errors: [...(snapshot.diagnostics.get(requestedPath) ?? [])] },
      file.tree,
    );
    const errors = [...(snapshot.diagnostics.get(requestedPath) ?? [])];
    return {
      path: requestedPath,
      ...rendered,
      errors,
      backReferences: await renderSectionBackReferences(
        snapshot.references,
        file.sections,
        this.latDir,
        this.projectRoot,
        (path) =>
          createMarkdownWikiLinkResolver(
            this.latDir,
            path,
            snapshot.allSections,
          ),
      ),
      frontmatter: {
        requireCodeMention:
          parseFrontmatter(file.content).requireCodeMention === true,
      },
    };
  }

  getSource(
    requestedPath: string,
    requestedSymbol = '',
    origin?: { sectionId: string; line: number },
    requestedLine = 0,
  ): Promise<ViewSourceDocument> {
    const snapshot = this.snapshotValue;
    return getViewSource(
      this.latDir,
      this.projectRoot,
      requestedPath,
      requestedSymbol,
      origin,
      requestedLine,
      snapshot.allSections,
      snapshot.references,
    );
  }

  refresh(paths: string[]): Promise<void> {
    if (this.closed) return Promise.resolve();
    const normalized = paths.map((path) =>
      path ? projectPath(this.projectRoot, path) : '',
    );
    const refresh = this.refreshTail.then(() => this.applyRefresh(normalized));
    this.refreshTail = refresh.catch(() => {});
    return refresh;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.watcher?.close();
    this.watcher = null;
    await this.refreshTail;
    this.listeners.clear();
  }

  private scheduleRefresh(path: string): void {
    if (this.closed) return;
    this.pendingPaths.add(path ? projectPath(this.projectRoot, path) : '');
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const paths = [...this.pendingPaths];
      this.pendingPaths.clear();
      void this.refresh(paths).catch((error: unknown) => {
        process.stderr.write(`lat ui refresh: ${(error as Error).message}\n`);
      });
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  private async readMarkdownFile(
    absolutePath: string,
  ): Promise<ViewParsedMarkdownFile | null> {
    let realFile: string;
    try {
      realFile = await realpath(absolutePath);
    } catch {
      return null;
    }
    if (!isInside(this.realLatDir, realFile)) return null;
    const content = await readFile(realFile, 'utf8');
    return parseViewMarkdownFile(
      absolutePath,
      content,
      this.latDir,
      this.projectRoot,
    );
  }

  private async applyRefresh(paths: string[]): Promise<void> {
    const fullRefresh = paths.includes('');
    const latPath = projectPath(this.projectRoot, this.latDir);
    const touchesMarkdown =
      fullRefresh ||
      paths.some((path) => path === latPath || path.startsWith(`${latPath}/`));
    let markdownFiles = new Map(this.snapshotValue.files);
    let codeFiles = new Map(this.codeFiles);
    let markdownChanged = false;
    let codeChanged = false;
    let linkedResourceChanged = false;

    if (touchesMarkdown) {
      const discovered = new Map(
        (await listLatticeFiles(this.latDir)).map((absolutePath) => [
          toPosix(relative(this.latDir, absolutePath)),
          absolutePath,
        ]),
      );
      const changed = new Set<string>();
      for (const path of markdownFiles.keys()) {
        if (!discovered.has(path)) changed.add(path);
      }
      for (const path of discovered.keys()) {
        if (!markdownFiles.has(path)) changed.add(path);
      }
      for (const path of paths) {
        if (path === '') {
          for (const markdownPath of discovered.keys())
            changed.add(markdownPath);
          continue;
        }
        if (path === latPath) continue;
        if (!path.startsWith(`${latPath}/`)) continue;
        const markdownPath = path.slice(latPath.length + 1);
        if (markdownPath.toLowerCase().endsWith('.md')) {
          changed.add(markdownPath);
        }
      }

      for (const path of [...changed].sort()) {
        const absolutePath = discovered.get(path);
        if (!absolutePath) {
          markdownChanged = markdownFiles.delete(path) || markdownChanged;
          continue;
        }
        const next = await this.readMarkdownFile(absolutePath);
        if (!next) {
          markdownChanged = markdownFiles.delete(path) || markdownChanged;
          continue;
        }
        if (markdownFiles.get(path)?.content === next.content) continue;
        markdownFiles.set(path, next);
        markdownChanged = true;
      }
      linkedResourceChanged = paths.some(
        (path) =>
          path.startsWith(`${latPath}/`) && !path.toLowerCase().endsWith('.md'),
      );
    }

    const codePaths = paths.filter(
      (path) =>
        path && sourcePath(path) && !obviouslyIgnoredCodePath(path, latPath),
    );
    const refreshCodeScope =
      fullRefresh ||
      paths.some(
        (path) => path === '.gitignore' || path.endsWith('/.gitignore'),
      ) ||
      codePaths.some(
        (path) => !this.codeScope.has(path) && !this.ignoredCodePaths.has(path),
      );

    if (refreshCodeScope) {
      const nextCode = await scanCodeState(this.projectRoot);
      codeFiles = nextCode.files;
      this.codeScope = nextCode.scope;
      this.ignoredCodePaths.clear();
      for (const path of codePaths) {
        if (!this.codeScope.has(path)) this.ignoredCodePaths.add(path);
      }
      codeChanged = true;
    } else {
      for (const path of codePaths) {
        if (this.ignoredCodePaths.has(path) || !this.codeScope.has(path)) {
          continue;
        }
        try {
          const content = await readFile(
            resolve(this.projectRoot, path),
            'utf8',
          );
          const refs = codeRefsFromContent(path, content);
          if (refs.length > 0) {
            codeFiles.set(path, {
              path,
              lines: content.split('\n'),
              refs,
            });
          } else {
            codeFiles.delete(path);
          }
        } catch {
          this.codeScope.delete(path);
          codeFiles.delete(path);
        }
        codeChanged = true;
      }
    }

    if (!markdownChanged && !codeChanged && !linkedResourceChanged) return;
    this.codeFiles = codeFiles;
    this.snapshotValue = await buildSnapshot(
      this.latDir,
      this.projectRoot,
      markdownFiles,
      codeFiles,
      this.snapshotValue.generation + 1,
      this.snapshotValue.markdownGeneration + (markdownChanged ? 1 : 0),
    );
    const change = {
      generation: this.snapshotValue.generation,
      markdownGeneration: this.snapshotValue.markdownGeneration,
    };
    for (const listener of this.listeners) listener(change);
  }
}

/** Build the initial project snapshot and optionally begin incremental updates. */
export async function createViewStore(
  latDir: string,
  projectRoot: string,
  options: ViewStoreOptions = {},
): Promise<ViewStore> {
  const [realLatDir, markdownPaths, codeState] = await Promise.all([
    realpath(latDir),
    listLatticeFiles(latDir),
    scanCodeState(projectRoot),
  ]);
  if (markdownPaths.length === 0) {
    throw new Error(`No Markdown files found in ${latDir}`);
  }

  const markdownFiles = new Map<string, ViewParsedMarkdownFile>();
  await Promise.all(
    markdownPaths.map(async (absolutePath) => {
      const realFile = await realpath(absolutePath);
      if (!isInside(realLatDir, realFile)) return;
      const content = await readFile(realFile, 'utf8');
      const parsed = parseViewMarkdownFile(
        absolutePath,
        content,
        latDir,
        projectRoot,
      );
      markdownFiles.set(parsed.path, parsed);
    }),
  );
  if (markdownFiles.size === 0) {
    throw new Error(`No readable Markdown files found in ${latDir}`);
  }

  const store = new ViewStore(
    latDir,
    projectRoot,
    realLatDir,
    await buildSnapshot(
      latDir,
      projectRoot,
      markdownFiles,
      codeState.files,
      0,
      0,
    ),
    codeState.files,
    codeState.scope,
    options,
  );
  store.startWatching();
  return store;
}
