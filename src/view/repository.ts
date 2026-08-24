import { readFile, realpath } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  buildFileIndex,
  buildSectionSlugIndex,
  flattenSections,
  listLatticeFiles,
  loadAllSections,
  parseFrontmatter,
  resolveRef,
  type Section,
} from '../lattice.js';
import {
  resolveSourceSymbol,
  SOURCE_EXTENSIONS,
  type SourceSymbol,
} from '../source-parser.js';
import { toPosix } from '../walk.js';
import type {
  ViewDocument,
  ViewIndex,
  ViewSourceDocument,
} from './protocol.js';
import { highlightSource } from './highlight.js';
import { renderMarkdown } from './markdown.js';
import {
  getSourceReferenceContext,
  type SourceReferenceOrigin,
} from './references.js';

export class ViewDocumentNotFoundError extends Error {}
export class ViewSourceNotFoundError extends Error {}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  );
}

async function markdownFiles(latDir: string): Promise<Map<string, string>> {
  const files = await listLatticeFiles(latDir);
  return new Map(
    files.map((file) => [toPosix(relative(latDir, file)), file] as const),
  );
}

function documentUrl(path: string): string {
  return `/docs/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function sourceUrl(
  path: string,
  symbol: string,
  origin?: SourceReferenceOrigin,
): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const query = new URLSearchParams();
  if (origin) {
    query.set('from', origin.sectionId);
    query.set('line', String(origin.line));
  }
  const search = query.size > 0 ? `?${query}` : '';
  const fragment = symbol ? `#${encodeURIComponent(symbol)}` : '';
  return `/code/${encodedPath}${search}${fragment}`;
}

function sourceTarget(target: string): {
  path: string;
  symbol: string;
} | null {
  const hash = target.indexOf('#');
  const path = hash === -1 ? target : target.slice(0, hash);
  if (!SOURCE_EXTENSIONS.has(extname(path))) return null;
  return { path, symbol: hash === -1 ? '' : target.slice(hash + 1) };
}

function matchingSymbol(
  symbols: SourceSymbol[],
  symbolPath: string,
): SourceSymbol | undefined {
  const parts = symbolPath.split('#');
  if (parts.length === 1) {
    return symbols.find((symbol) => symbol.name === parts[0] && !symbol.parent);
  }
  if (parts.length === 2) {
    return symbols.find(
      (symbol) => symbol.parent === parts[0] && symbol.name === parts[1],
    );
  }
  return undefined;
}

async function markdownWikiLinkResolver(
  latDir: string,
  requestedPath: string,
): Promise<
  (target: string, context: { line: number }) => Promise<string | null>
> {
  const projectRoot = dirname(latDir);
  const sections = await loadAllSections(latDir, projectRoot);
  const flat = flattenSections(sections);
  const sectionIds = new Set(flat.map((section) => section.id.toLowerCase()));
  const fileIndex = buildFileIndex(sections);
  const slugIndex = buildSectionSlugIndex(sections);
  const byId = new Map(
    flat.map((section) => [section.id.toLowerCase(), section]),
  );
  const currentFile = toPosix(
    relative(projectRoot, resolve(latDir, requestedPath)),
  );
  const currentSections = flat
    .filter((section) => section.filePath === currentFile)
    .sort((a, b) => a.startLine - b.startLine);

  return async (target, context) => {
    const result = resolveRef(target, sectionIds, fileIndex, slugIndex);
    if (result.ambiguous) return null;

    const section = byId.get(result.resolved.toLowerCase());
    if (section) {
      const absoluteFile = resolve(projectRoot, section.filePath);
      const file = toPosix(relative(latDir, absoluteFile));
      const fragment =
        target.includes('#') && section.githubSlug
          ? `#${encodeURIComponent(section.githubSlug)}`
          : '';
      return `${documentUrl(file)}${fragment}`;
    }

    const source = sourceTarget(target);
    if (!source) return null;
    try {
      await readViewSource(projectRoot, source.path, source.symbol);
      let section: Section | undefined;
      for (const candidate of currentSections) {
        if (candidate.startLine > context.line) break;
        section = candidate;
      }
      const origin = section
        ? { sectionId: section.id, line: context.line }
        : undefined;
      return sourceUrl(source.path, source.symbol, origin);
    } catch (error) {
      if (error instanceof ViewSourceNotFoundError) return null;
      throw error;
    }
  };
}

async function readViewSource(
  projectRoot: string,
  requestedPath: string,
  requestedSymbol = '',
): Promise<
  Omit<
    ViewSourceDocument,
    'highlightedHtmlLines' | 'context' | 'otherReferences'
  >
> {
  if (
    !requestedPath ||
    requestedPath.includes('\\') ||
    isAbsolute(requestedPath) ||
    !SOURCE_EXTENSIONS.has(extname(requestedPath))
  ) {
    throw new ViewSourceNotFoundError('Source document not found');
  }

  const candidate = resolve(projectRoot, requestedPath);
  let realRoot: string;
  let realFile: string;
  try {
    [realRoot, realFile] = await Promise.all([
      realpath(projectRoot),
      realpath(candidate),
    ]);
  } catch {
    throw new ViewSourceNotFoundError('Source document not found');
  }
  if (!isInside(realRoot, realFile)) {
    throw new ViewSourceNotFoundError('Source document not found');
  }

  const content = await readFile(realFile, 'utf-8');
  if (!requestedSymbol) {
    return { path: requestedPath, content, focus: null };
  }

  const resolved = await resolveSourceSymbol(
    requestedPath,
    requestedSymbol,
    projectRoot,
  );
  const symbol = resolved.found
    ? matchingSymbol(resolved.symbols, requestedSymbol)
    : undefined;
  if (!symbol) {
    throw new ViewSourceNotFoundError('Source symbol not found');
  }

  return {
    path: requestedPath,
    content,
    focus: {
      symbol: requestedSymbol,
      kind: symbol.kind,
      signature: symbol.signature,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    },
  };
}

/** Read and highlight a source file after constraining it to the project root. */
export async function getViewSource(
  latDir: string,
  projectRoot: string,
  requestedPath: string,
  requestedSymbol = '',
  origin?: SourceReferenceOrigin,
): Promise<ViewSourceDocument> {
  const source = await readViewSource(
    projectRoot,
    requestedPath,
    requestedSymbol,
  );
  const references = await getSourceReferenceContext(
    latDir,
    projectRoot,
    `${source.path}${requestedSymbol ? `#${requestedSymbol}` : ''}`,
    origin,
    (requestedPath) => markdownWikiLinkResolver(latDir, requestedPath),
  );
  return {
    ...source,
    highlightedHtmlLines: highlightSource(source.path, source.content),
    ...references,
  };
}

/** List browser-visible Markdown files and choose the conventional root index. */
export async function getViewIndex(latDir: string): Promise<ViewIndex> {
  const files = [...(await markdownFiles(latDir)).keys()].sort();
  if (files.length === 0) {
    throw new Error(`No Markdown files found in ${latDir}`);
  }

  const directoryName = basename(latDir);
  const indexName = directoryName.endsWith('.md')
    ? directoryName
    : `${directoryName}.md`;
  return { files, entry: files.includes(indexName) ? indexName : files[0] };
}

/** Read and render one Markdown file after constraining it to the lat.md vault. */
export async function getViewDocument(
  latDir: string,
  requestedPath: string,
): Promise<ViewDocument> {
  if (
    !requestedPath ||
    requestedPath.includes('\\') ||
    isAbsolute(requestedPath) ||
    !requestedPath.toLowerCase().endsWith('.md')
  ) {
    throw new ViewDocumentNotFoundError('Markdown document not found');
  }

  const files = await markdownFiles(latDir);
  const filePath = files.get(requestedPath);
  if (!filePath) {
    throw new ViewDocumentNotFoundError('Markdown document not found');
  }

  const [realRoot, realFile] = await Promise.all([
    realpath(latDir),
    realpath(filePath),
  ]);
  if (!isInside(realRoot, realFile)) {
    throw new ViewDocumentNotFoundError('Markdown document not found');
  }

  const [markdown, resolveWikiLink] = await Promise.all([
    readFile(resolve(filePath), 'utf-8'),
    markdownWikiLinkResolver(latDir, requestedPath),
  ]);
  const rendered = await renderMarkdown(
    markdown,
    requestedPath,
    resolveWikiLink,
  );
  return {
    path: requestedPath,
    ...rendered,
    frontmatter: {
      requireCodeMention:
        parseFrontmatter(markdown).requireCodeMention === true,
    },
  };
}
