import { readFile, realpath } from 'node:fs/promises';
import {
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
  resolveRef,
  type Section,
} from '../lattice.js';
import {
  resolveSourceSymbol,
  SOURCE_EXTENSIONS,
  type SourceSymbol,
} from '../source-parser.js';
import { toPosix } from '../walk.js';
import type { ViewSourceDocument } from './protocol.js';
import { highlightSource } from './highlight.js';
import {
  renderSourceReferenceContext,
  type SourceReferenceOrigin,
  type ViewReferenceIndex,
} from './references.js';
import { viewSourceTarget } from './source-target.js';

export class ViewDocumentNotFoundError extends Error {}
export class ViewSourceNotFoundError extends Error {}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
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

export async function createMarkdownWikiLinkResolver(
  latDir: string,
  requestedPath: string,
  loadedSections: Section[],
  referenceIndex?: ViewReferenceIndex,
): Promise<
  (
    target: string,
    context: { line: number },
  ) => Promise<{ href: string; referenceCount: number } | null>
> {
  const projectRoot = dirname(latDir);
  const flat = flattenSections(loadedSections);
  const sectionIds = new Set(flat.map((section) => section.id.toLowerCase()));
  const fileIndex = buildFileIndex(loadedSections);
  const slugIndex = buildSectionSlugIndex(loadedSections);
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
      return {
        href: `${documentUrl(file)}${fragment}`,
        referenceCount:
          referenceIndex?.incomingBySection.get(section.id.toLowerCase())
            ?.length ?? 0,
      };
    }

    const source = viewSourceTarget(target);
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
      return {
        href: sourceUrl(source.path, source.symbol, origin),
        referenceCount:
          referenceIndex?.sourceReferenceCounts.get(source.key) ?? 0,
      };
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
  requestedLine = 0,
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
    if (!requestedLine) return { path: requestedPath, content, focus: null };
    const line = content.split('\n')[requestedLine - 1];
    if (line === undefined) {
      throw new ViewSourceNotFoundError('Source line not found');
    }
    return {
      path: requestedPath,
      content,
      focus: {
        symbol: `line ${requestedLine}`,
        kind: 'reference',
        signature: line.trim() || `Line ${requestedLine}`,
        startLine: requestedLine,
        endLine: requestedLine,
      },
    };
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
  requestedLine = 0,
  allSections: Section[] = [],
  referenceIndex?: ViewReferenceIndex,
): Promise<ViewSourceDocument> {
  const source = await readViewSource(
    projectRoot,
    requestedPath,
    requestedSymbol,
    requestedLine,
  );
  const references = referenceIndex
    ? await renderSourceReferenceContext(
        referenceIndex,
        `${source.path}${requestedSymbol ? `#${requestedSymbol}` : ''}`,
        origin,
        latDir,
        projectRoot,
        (path) =>
          createMarkdownWikiLinkResolver(
            latDir,
            path,
            allSections,
            referenceIndex,
          ),
      )
    : { context: null, otherReferences: [] };
  return {
    ...source,
    highlightedHtmlLines: highlightSource(source.path, source.content),
    ...references,
  };
}
