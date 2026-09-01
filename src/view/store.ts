import { randomUUID } from 'node:crypto';
import { watch as watchFiles, type FSWatcher } from 'node:fs';
import {
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  createCodeReferenceDiscovery,
  LAT_REF_RE,
  type CodeRef,
} from '../code-refs.js';
import {
  createExternalResolver,
  type ExternalResolver,
} from '../external-sources.js';
import type { Section } from '../lattice-model.js';
import { listLatticeFiles } from '../project-discovery.js';
import { analyzeMarkdownPath } from '../markdown-analysis-cache.js';
import { isSourceFileExtension } from '../source-formats.js';
import { toPosix } from '../path.js';
import { renderMarkdown } from './markdown.js';
import { buildViewDiagnostics } from './diagnostics.js';
import {
  applyDocumentEdit,
  ViewDocumentConflictError,
} from './document-edit.js';
import { buildGitDiffTree } from './git-diff.js';
import { buildViewGraph } from './graph.js';
import { buildViewTableOfContents } from './table-of-contents.js';
import {
  emptyViewGitSnapshot,
  findViewGitRepository,
  readViewGitSnapshot,
  sameViewGitSnapshot,
  type ViewGitRepository,
  type ViewGitSnapshot,
} from './git.js';
import type {
  ViewDocument,
  ViewDocumentEditResponse,
  ViewDocumentError,
  ViewDocumentSource,
  ViewExternalDocument,
  ViewExternalFile,
  ViewGraph,
  ViewIndex,
  ViewProjectGeneration,
  ViewDocumentTree,
  ViewSourceDocument,
} from './protocol.js';
import { DEFAULT_VIEW_LOGO_TEXT } from './protocol.js';
import {
  createMarkdownWikiLinkResolver,
  getViewExternal,
  getViewSource,
  ViewDocumentNotFoundError,
} from './repository.js';
import {
  buildViewReferenceIndex,
  renderSectionBackReferences,
  type ViewCodeReferenceFile,
  type ViewParsedMarkdownFile,
  type ViewReferenceIndex,
} from './references.js';
import { rewriteDocumentLink } from './document-route.js';

const DEFAULT_DEBOUNCE_MS = 75;
const DEFAULT_GIT_POLL_MS = 2_000;
const EXTERNAL_REFRESH_PATH = '@lat-external-refresh';
const DOCUMENT_EDIT_WRITE_ATTEMPTS = 3;
const DOCUMENT_EDIT_TEMP_PREFIX = '.lat-edit-';

export type ViewProjectSnapshot = {
  generation: number;
  markdownGeneration: number;
  files: ReadonlyMap<string, ViewParsedMarkdownFile>;
  allSections: Section[];
  references: ViewReferenceIndex;
  graph: ViewGraph;
  diagnostics: ReadonlyMap<string, readonly ViewDocumentError[]>;
  git: ViewGitSnapshot;
  index: ViewIndex;
  external: ExternalResolver;
};

export type ViewStoreOptions = {
  codeExcludePaths?: string[];
  debounceMs?: number;
  git?: boolean;
  gitPollMs?: number;
  watch?: boolean;
  externalIgnoreLocal?: boolean;
  externalCa?: string | Buffer;
};

type ViewStoreListener = (change: ViewProjectGeneration) => void;

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

function isInternalLatCachePath(path: string, latPath: string): boolean {
  const cachePath = latPath ? `${latPath}/.cache` : '.cache';
  return path === cachePath || path.startsWith(`${cachePath}/`);
}

function excludedCodePath(
  projectRoot: string,
  path: string,
  excludedPaths: readonly string[],
): boolean {
  const absolutePath = resolve(projectRoot, path);
  return excludedPaths.some((root) => isInside(resolve(root), absolutePath));
}

function sourcePath(path: string): boolean {
  return isSourceFileExtension(extname(path).toLowerCase());
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

async function scanCodeState(
  projectRoot: string,
  excludedPaths: readonly string[] = [],
): Promise<{
  files: Map<string, ViewCodeReferenceFile>;
  scope: Set<string>;
}> {
  const discovery = createCodeReferenceDiscovery(projectRoot);
  const [scan, sourceFiles] = await Promise.all([
    discovery.scan(),
    discovery.listSourceFiles(),
  ]);
  const allowed = (path: string) =>
    !excludedCodePath(projectRoot, path, excludedPaths);
  const files = sourceFiles.filter(allowed);
  const refs = scan.refs.filter((ref) => allowed(ref.file));
  const scope = new Set(files.map((path) => projectPath(projectRoot, path)));
  return {
    files: await loadCodeReferenceFiles(projectRoot, refs),
    scope,
  };
}

function viewIndex(
  latDir: string,
  paths: string[],
  diagnostics: ReadonlyMap<string, readonly ViewDocumentError[]>,
  git: ViewGitSnapshot,
  references: ViewReferenceIndex,
  external: ExternalResolver,
): ViewIndex {
  const files = [...paths].sort();
  const externalFiles = new Map<string, ViewExternalFile>();
  for (const target of references.externalByTarget.keys()) {
    try {
      const parsed = external.parse(target);
      if (!parsed) continue;
      const hash = parsed.identity.indexOf('#');
      const baseTarget =
        hash === -1 ? parsed.identity : parsed.identity.slice(0, hash);
      externalFiles.set(baseTarget, {
        handle: parsed.handle,
        path: parsed.resolvedPath,
        target: baseTarget,
      });
    } catch {
      // Invalid external targets remain diagnostics, not sidebar entries.
    }
  }
  const directoryName = basename(latDir);
  const indexName = directoryName.endsWith('.md')
    ? directoryName
    : `${directoryName}.md`;
  return {
    files,
    externalFiles: [...externalFiles.values()].sort(
      (left, right) =>
        left.handle.localeCompare(right.handle) ||
        left.path.localeCompare(right.path),
    ),
    entry: files.includes(indexName) ? indexName : (files[0] ?? ''),
    errorCounts: Object.fromEntries(
      [...diagnostics]
        .filter(([, errors]) => errors.length > 0)
        .map(([path, errors]) => [path, errors.length]),
    ),
    git: git.available
      ? {
          files: Object.fromEntries(
            [...git.files].map(([path, file]) => [path, file.status]),
          ),
        }
      : null,
    logoText: DEFAULT_VIEW_LOGO_TEXT,
  };
}

async function buildSnapshot(
  latDir: string,
  projectRoot: string,
  markdownFiles: Map<string, ViewParsedMarkdownFile>,
  codeFiles: Map<string, ViewCodeReferenceFile>,
  git: ViewGitSnapshot,
  generation: number,
  markdownGeneration: number,
  options: ViewStoreOptions,
): Promise<ViewProjectSnapshot> {
  const files = new Map(
    [...markdownFiles].sort(([left], [right]) => left.localeCompare(right)),
  );
  const allSections = [...files.values()].flatMap((file) => file.sections);
  const external = await createExternalResolver(latDir, projectRoot, {
    ignoreLocal: options.externalIgnoreLocal,
    ca: options.externalCa,
  });
  await external.reconcile();
  const diagnostics = await buildViewDiagnostics(
    files.values(),
    codeFiles.values(),
    allSections,
    projectRoot,
    external,
    latDir,
  );
  const references = buildViewReferenceIndex(
    files.values(),
    codeFiles.values(),
    allSections,
    (target) => {
      try {
        return external.parse(target)?.identity ?? null;
      } catch {
        return target;
      }
    },
  );
  return {
    generation,
    markdownGeneration,
    files,
    allSections,
    references,
    graph: buildViewGraph(
      files.values(),
      codeFiles.values(),
      allSections,
      diagnostics,
      git,
      generation,
      external,
    ),
    diagnostics,
    git,
    index: viewIndex(
      latDir,
      [...files.keys()],
      diagnostics,
      git,
      references,
      external,
    ),
    external,
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
  private externalWatchers: FSWatcher[] = [];
  private pendingPaths = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private gitPollTimer: NodeJS.Timeout | null = null;
  private gitPollQueued = false;
  private refreshTail: Promise<void> = Promise.resolve();
  private editTail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    readonly latDir: string,
    readonly projectRoot: string,
    private readonly realLatDir: string,
    snapshot: ViewProjectSnapshot,
    codeFiles: Map<string, ViewCodeReferenceFile>,
    codeScope: Set<string>,
    private readonly gitRepository: ViewGitRepository | null,
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
    this.startGitPolling();
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
    this.refreshExternalWatchers();
  }

  private refreshExternalWatchers(): void {
    for (const watcher of this.externalWatchers) watcher.close();
    this.externalWatchers = [];
    if (this.options.watch === false) return;
    const paths = new Set(
      [...this.snapshotValue.external.snapshot.sources.values()]
        .map((source) => source.localPath)
        .filter((path): path is string => Boolean(path)),
    );
    for (const path of paths) {
      try {
        const watcher = watchFiles(path, { recursive: true }, () =>
          this.scheduleRefresh(EXTERNAL_REFRESH_PATH),
        );
        watcher.on('error', (error) => {
          process.stderr.write(`lat ui external watcher: ${error.message}\n`);
        });
        this.externalWatchers.push(watcher);
      } catch (error) {
        process.stderr.write(
          `lat ui external watcher: ${(error as Error).message}\n`,
        );
      }
    }
  }

  subscribe(listener: ViewStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getIndex(): ViewIndex {
    return this.snapshotValue.index;
  }

  getGraph(): ViewGraph {
    return this.snapshotValue.graph;
  }

  async renderSectionOutput(
    markdown: string,
    sectionId: string,
  ): Promise<ViewDocumentTree> {
    const snapshot = this.snapshotValue;
    const section = snapshot.allSections.find(
      (candidate) => candidate.id.toLowerCase() === sectionId.toLowerCase(),
    );
    const requestedPath = section
      ? toPosix(
          relative(this.latDir, resolve(this.projectRoot, section.filePath)),
        )
      : 'section-output.md';
    const resolver = await createMarkdownWikiLinkResolver(
      this.latDir,
      requestedPath,
      snapshot.allSections,
      snapshot.references,
      snapshot.external,
    );
    return (await renderMarkdown(markdown, requestedPath, resolver)).tree;
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
      snapshot.references,
      snapshot.external,
    );
    const rendered = await renderMarkdown(
      file.content,
      requestedPath,
      resolver,
      {
        errors: [...(snapshot.diagnostics.get(requestedPath) ?? [])],
        rewriteMarkdownLink: (url) => rewriteDocumentLink(url, requestedPath),
      },
    );
    const errors = [...(snapshot.diagnostics.get(requestedPath) ?? [])];
    const gitFile = snapshot.git.files.get(requestedPath);
    const gitTree = gitFile
      ? buildGitDiffTree(gitFile.baseContent, file.content)
      : null;
    const gitRendered = gitTree
      ? await renderMarkdown(
          file.content,
          requestedPath,
          resolver,
          {
            errors,
            rewriteMarkdownLink: (url) =>
              rewriteDocumentLink(url, requestedPath),
          },
          gitTree,
        )
      : null;
    return {
      path: requestedPath,
      ...rendered,
      gitTree: gitRendered?.tree ?? null,
      tableOfContents: buildViewTableOfContents(
        file.sections,
        file.headingTitles,
        { errors, gitTree },
      ),
      graphNodeIds: Object.fromEntries(
        snapshot.graph.nodes
          .filter(
            (node) =>
              node.documentPath === requestedPath && node.kind === 'document',
          )
          .map((node) => {
            const hash = new URL(node.url, 'http://lat.local').hash.slice(1);
            let headingId = hash;
            try {
              headingId = decodeURIComponent(hash);
            } catch {
              // Keep malformed fragments as-is; they cannot collide with valid ids.
            }
            return [headingId, node.id];
          }),
      ),
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
            snapshot.references,
            snapshot.external,
          ),
      ),
      frontmatter: {
        requireCodeMention: file.frontmatter.requireCodeMention === true,
      },
    };
  }

  private async editableDocumentPath(requestedPath: string): Promise<string> {
    if (
      !requestedPath ||
      requestedPath.includes('\\') ||
      isAbsolute(requestedPath) ||
      !requestedPath.toLowerCase().endsWith('.md') ||
      !this.snapshotValue.files.has(requestedPath)
    ) {
      throw new ViewDocumentNotFoundError('Markdown document not found');
    }
    let realFile: string;
    try {
      realFile = await realpath(resolve(this.latDir, requestedPath));
    } catch {
      throw new ViewDocumentNotFoundError('Markdown document not found');
    }
    if (!isInside(this.realLatDir, realFile)) {
      throw new ViewDocumentNotFoundError('Markdown document not found');
    }
    return realFile;
  }

  async getDocumentSource(requestedPath: string): Promise<ViewDocumentSource> {
    const path = await this.editableDocumentPath(requestedPath);
    return { path: requestedPath, content: await readFile(path, 'utf8') };
  }

  editDocument(
    requestedPath: string,
    baseContent: string,
    editedContent: string,
  ): Promise<ViewDocumentEditResponse> {
    const operation = this.editTail.then(async () => {
      const path = await this.editableDocumentPath(requestedPath);
      for (let attempt = 0; attempt < DOCUMENT_EDIT_WRITE_ATTEMPTS; attempt++) {
        const currentContent = await readFile(path, 'utf8');
        const edit = applyDocumentEdit(
          baseContent,
          editedContent,
          currentContent,
        );
        if (edit.content === currentContent) {
          return { path: requestedPath, ...edit };
        }

        const currentStat = await stat(path);
        const temporaryPath = resolve(
          this.latDir,
          `${DOCUMENT_EDIT_TEMP_PREFIX}${process.pid}-${randomUUID()}.tmp`,
        );
        try {
          await writeFile(temporaryPath, edit.content, {
            encoding: 'utf8',
            flag: 'wx',
            mode: currentStat.mode,
          });
          if ((await readFile(path, 'utf8')) !== currentContent) continue;
          await rename(temporaryPath, path);
        } finally {
          await rm(temporaryPath, { force: true });
        }
        await this.refresh([resolve(this.latDir, requestedPath)]);
        return { path: requestedPath, ...edit };
      }
      throw new ViewDocumentConflictError(
        'Could not save because this file kept changing. Your edits are still in the editor.',
      );
    });
    this.editTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
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

  getExternal(target: string): Promise<ViewExternalDocument> {
    const snapshot = this.snapshotValue;
    return getViewExternal(
      this.latDir,
      this.projectRoot,
      target,
      snapshot.external,
      snapshot.allSections,
      snapshot.references,
    );
  }

  refresh(paths: string[]): Promise<void> {
    if (this.closed) return Promise.resolve();
    const latPath = projectPath(this.projectRoot, this.latDir);
    const normalized = paths
      .map((path) => (path ? projectPath(this.projectRoot, path) : ''))
      .filter((path) => !isInternalLatCachePath(path, latPath));
    if (paths.length > 0 && normalized.length === 0) {
      return Promise.resolve();
    }
    return this.queueRefresh(normalized, false);
  }

  private queueRefresh(paths: string[], pollGit: boolean): Promise<void> {
    const refresh = this.refreshTail.then(() =>
      this.applyRefresh(paths, pollGit),
    );
    this.refreshTail = refresh.catch(() => {});
    return refresh;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.gitPollTimer) clearInterval(this.gitPollTimer);
    this.gitPollTimer = null;
    this.watcher?.close();
    this.watcher = null;
    for (const watcher of this.externalWatchers) watcher.close();
    this.externalWatchers = [];
    await this.editTail;
    await this.refreshTail;
    this.listeners.clear();
  }

  private scheduleRefresh(path: string): void {
    if (this.closed) return;
    if (
      path !== EXTERNAL_REFRESH_PATH &&
      basename(path).startsWith(DOCUMENT_EDIT_TEMP_PREFIX) &&
      path.endsWith('.tmp')
    ) {
      return;
    }
    const normalizedPath =
      path === EXTERNAL_REFRESH_PATH
        ? path
        : path
          ? projectPath(this.projectRoot, path)
          : '';
    const latPath = projectPath(this.projectRoot, this.latDir);
    if (isInternalLatCachePath(normalizedPath, latPath)) return;
    this.pendingPaths.add(normalizedPath);
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

  private startGitPolling(): void {
    const interval = this.options.gitPollMs ?? DEFAULT_GIT_POLL_MS;
    if (!this.gitRepository || interval <= 0 || this.gitPollTimer) return;
    this.gitPollTimer = setInterval(() => {
      if (this.closed || this.gitPollQueued) return;
      this.gitPollQueued = true;
      void this.queueRefresh([], true)
        .catch((error: unknown) => {
          process.stderr.write(`lat ui git: ${(error as Error).message}\n`);
        })
        .finally(() => {
          this.gitPollQueued = false;
        });
    }, interval);
    this.gitPollTimer.unref();
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
    return analyzeMarkdownPath(absolutePath, this.latDir, this.projectRoot);
  }

  private async applyRefresh(paths: string[], pollGit: boolean): Promise<void> {
    const fullRefresh = paths.includes('');
    const latPath = projectPath(this.projectRoot, this.latDir);
    const externalChanged =
      paths.includes(EXTERNAL_REFRESH_PATH) ||
      paths.includes(`${latPath}/config.local.yaml`);
    const touchesMarkdown =
      fullRefresh ||
      paths.some((path) => path === latPath || path.startsWith(`${latPath}/`));
    let markdownFiles = new Map(this.snapshotValue.files);
    let codeFiles = new Map(this.codeFiles);
    let markdownChanged = false;
    let codeChanged = false;
    let git = this.snapshotValue.git;
    let gitChanged = false;
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

    if ((touchesMarkdown || pollGit) && this.gitRepository) {
      try {
        const nextGit = await readViewGitSnapshot(
          this.gitRepository,
          markdownFiles,
        );
        gitChanged = !sameViewGitSnapshot(git, nextGit);
        git = nextGit;
      } catch (error) {
        process.stderr.write(`lat ui git: ${(error as Error).message}\n`);
      }
    }

    const codePaths = paths.filter(
      (path) =>
        path &&
        sourcePath(path) &&
        !obviouslyIgnoredCodePath(path, latPath) &&
        !excludedCodePath(
          this.projectRoot,
          path,
          this.options.codeExcludePaths ?? [],
        ),
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
      const nextCode = await scanCodeState(
        this.projectRoot,
        this.options.codeExcludePaths,
      );
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

    if (
      !markdownChanged &&
      !codeChanged &&
      !gitChanged &&
      !linkedResourceChanged &&
      !externalChanged
    )
      return;
    this.codeFiles = codeFiles;
    this.snapshotValue = await buildSnapshot(
      this.latDir,
      this.projectRoot,
      markdownFiles,
      codeFiles,
      git,
      this.snapshotValue.generation + 1,
      this.snapshotValue.markdownGeneration + (markdownChanged ? 1 : 0),
      this.options,
    );
    this.refreshExternalWatchers();
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
  const [realLatDir, markdownPaths, codeState, gitRepository] =
    await Promise.all([
      realpath(latDir),
      listLatticeFiles(latDir),
      scanCodeState(projectRoot, options.codeExcludePaths),
      options.git === false
        ? Promise.resolve(null)
        : findViewGitRepository(projectRoot, latDir),
    ]);
  if (markdownPaths.length === 0) {
    throw new Error(`No Markdown files found in ${latDir}`);
  }

  const markdownFiles = new Map<string, ViewParsedMarkdownFile>();
  await Promise.all(
    markdownPaths.map(async (absolutePath) => {
      const realFile = await realpath(absolutePath);
      if (!isInside(realLatDir, realFile)) return;
      const parsed = await analyzeMarkdownPath(
        absolutePath,
        latDir,
        projectRoot,
      );
      markdownFiles.set(parsed.path, parsed);
    }),
  );
  if (markdownFiles.size === 0) {
    throw new Error(`No readable Markdown files found in ${latDir}`);
  }

  let git = emptyViewGitSnapshot();
  if (gitRepository) {
    try {
      git = await readViewGitSnapshot(gitRepository, markdownFiles);
    } catch (error) {
      process.stderr.write(`lat ui git: ${(error as Error).message}\n`);
    }
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
      git,
      0,
      0,
      options,
    ),
    codeState.files,
    codeState.scope,
    gitRepository,
    options,
  );
  store.startWatching();
  return store;
}
