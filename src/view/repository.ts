import { readFile, realpath } from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
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
  createExternalResolver,
  type ExternalResolver,
} from '../external-sources.js';
import {
  addExternalDocumentAliasAnchors,
  externalDocumentSections,
} from '../external-documents.js';
import type { ExternalTarget } from '../external-sources.js';
import {
  resolveSourceSymbol,
  SourceParserRuntime,
  type SourceSymbol,
} from '../source-parser.js';
import { isSourceFileExtension } from '../source-formats.js';
import { toPosix } from '../walk.js';
import { renderExternalDocumentTree } from './external-document-tree.js';
import { visitDocumentElements } from './document-tree.js';
import type { ViewExternalDocument, ViewSourceDocument } from './protocol.js';
import { highlightSource } from './highlight.js';
import { renderMarkdown } from './markdown.js';
import {
  renderExternalSectionBackReferences,
  renderExternalSourceReferences,
  renderSourceReferenceContext,
  type SourceReferenceOrigin,
  type ViewReferenceIndex,
} from './references.js';
import { buildViewTableOfContents } from './table-of-contents.js';
import { viewSourceTarget } from './source-target.js';

export class ViewDocumentNotFoundError extends Error {}
export class ViewSourceNotFoundError extends Error {}
export class ViewExternalNotFoundError extends Error {}

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

export function externalUrl(target: string): string {
  const colon = target.indexOf(':');
  const hash = target.indexOf('#', colon + 1);
  const handle = target.slice(0, colon);
  const path =
    hash === -1 ? target.slice(colon + 1) : target.slice(colon + 1, hash);
  const fragment = hash === -1 ? '' : target.slice(hash + 1);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `/external/${encodeURIComponent(handle)}/${encodedPath}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
}

function baseExternalTarget(identity: string): string {
  const hash = identity.indexOf('#');
  return hash === -1 ? identity : identity.slice(0, hash);
}

function externalFileKey(handle: string, path: string): string {
  return `${handle}\0${path}`;
}

function availableExternalFiles(
  external: ExternalResolver,
  referenceIndex: ViewReferenceIndex,
  current: ExternalTarget,
): Map<string, string> {
  const files = new Map<string, string>();
  for (const target of referenceIndex.externalByTarget.keys()) {
    try {
      const parsed = external.parse(target);
      if (!parsed) continue;
      files.set(
        externalFileKey(parsed.handle, parsed.resolvedPath),
        baseExternalTarget(parsed.identity),
      );
    } catch {
      // Invalid external references remain diagnostics and are not navigable.
    }
  }
  files.set(
    externalFileKey(current.handle, current.resolvedPath),
    baseExternalTarget(current.identity),
  );
  return files;
}

function externalDocumentLink(
  href: string,
  current: ExternalTarget,
  external: ExternalResolver,
  available: ReadonlyMap<string, string>,
): string | null | undefined {
  if (
    href.startsWith('#') ||
    href.startsWith('?') ||
    href.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(href) ||
    /^\/(?:code|docs|external)(?:\/|$)/.test(href)
  ) {
    return undefined;
  }

  let destination: URL;
  try {
    const encodedPath = current.resolvedPath
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    destination = new URL(href, `http://lat.external/${encodedPath}`);
  } catch {
    return null;
  }
  if (destination.origin !== 'http://lat.external') return undefined;

  let path: string;
  let fragment: string;
  try {
    path = destination.pathname
      .slice(1)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
    fragment = decodeURIComponent(destination.hash.slice(1));
  } catch {
    return null;
  }
  path = posix.normalize(path);
  if (!path || path === '.' || path === '..' || path.startsWith('../')) {
    return null;
  }

  let parsed: ExternalTarget | null;
  try {
    parsed = external.parse(
      `${current.handle}:${path}${fragment ? `#${fragment}` : ''}`,
    );
  } catch {
    return null;
  }
  if (!parsed) return null;
  const availableTarget = available.get(
    externalFileKey(parsed.handle, parsed.resolvedPath),
  );
  if (!availableTarget) return null;

  const route = externalUrl(
    `${availableTarget}${fragment ? `#${fragment}` : ''}`,
  );
  if (!destination.search) return route;
  const hash = route.indexOf('#');
  return hash === -1
    ? `${route}${destination.search}`
    : `${route.slice(0, hash)}${destination.search}${route.slice(hash)}`;
}

/** Make repository-relative external-document links reflect pulled files. */
export function resolveExternalDocumentLinks(
  tree: Awaited<ReturnType<typeof renderExternalDocumentTree>>,
  current: ExternalTarget,
  external: ExternalResolver,
  referenceIndex: ViewReferenceIndex,
): typeof tree {
  const available = availableExternalFiles(external, referenceIndex, current);
  visitDocumentElements(tree, (element) => {
    if (element.tagName !== 'a') return;
    const href = element.properties.href;
    if (typeof href !== 'string') return;
    const resolved = externalDocumentLink(href, current, external, available);
    if (resolved === undefined) return;
    if (resolved !== null) {
      element.properties.href = resolved;
      return;
    }

    const currentClasses = element.properties.className;
    const classes = Array.isArray(currentClasses)
      ? currentClasses.map(String)
      : typeof currentClasses === 'string'
        ? currentClasses.split(/\s+/).filter(Boolean)
        : [];
    element.tagName = 'span';
    element.properties = {
      ...element.properties,
      className: [...classes, 'external-source-link-unavailable'],
      title: 'Linked file is not included in this Lat project',
    };
    delete element.properties.href;
  });
  return tree;
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
  externalResolver?: ExternalResolver,
): Promise<
  (
    target: string,
    context: { line: number },
  ) => Promise<{ href: string; referenceCount: number } | null>
> {
  const external =
    externalResolver ?? (await createExternalResolver(latDir, dirname(latDir)));
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
    try {
      const parsed = external.parse(target);
      if (parsed) {
        return {
          href: externalUrl(parsed.identity),
          referenceCount:
            referenceIndex?.externalByTarget.get(parsed.identity)?.length ?? 0,
        };
      }
    } catch {
      return null;
    }
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
      await readViewSource(latDir, projectRoot, source.path, source.symbol);
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

/** Resolve and render one configured external file through the normal view models. */
export async function getViewExternal(
  latDir: string,
  projectRoot: string,
  targetValue: string,
  external: ExternalResolver,
  allSections: Section[],
  referenceIndex: ViewReferenceIndex,
): Promise<ViewExternalDocument> {
  let resolved;
  try {
    resolved = await external.resolve(targetValue);
  } catch (error) {
    throw new ViewExternalNotFoundError((error as Error).message);
  }
  const createResolver = (path: string) =>
    createMarkdownWikiLinkResolver(
      latDir,
      path,
      allSections,
      referenceIndex,
      external,
    );

  if (resolved.kind === 'document') {
    const virtualPath = join(
      projectRoot,
      'lat.md',
      '.external',
      resolved.target.handle,
      resolved.target.resolvedPath,
    );
    const analysis = resolved.document;
    const sections = externalDocumentSections(virtualPath, analysis);
    const resolver = await createResolver(resolved.target.resolvedPath);
    const rendered =
      analysis.format === 'markdown'
        ? await renderMarkdown(
            resolved.fullContent,
            resolved.target.resolvedPath,
            resolver,
            {},
          )
        : {
            title: analysis.title,
            tree: await renderExternalDocumentTree(
              analysis.format,
              resolved.fullContent,
            ),
          };
    resolveExternalDocumentLinks(
      rendered.tree,
      resolved.target,
      external,
      referenceIndex,
    );
    const fragmentIndex = resolved.target.identity.indexOf('#');
    const baseTarget =
      fragmentIndex === -1
        ? resolved.target.identity
        : resolved.target.identity.slice(0, fragmentIndex);
    const targetHeadings = new Map<string, string>();
    targetHeadings.set(baseTarget, analysis.sections[0]?.anchor ?? '');
    for (const section of analysis.sections) {
      for (const alias of section.aliases) {
        const target = `${baseTarget}#${alias}`;
        if (!targetHeadings.has(target)) {
          targetHeadings.set(target, section.anchor);
        }
      }
    }
    return {
      kind: 'markdown',
      target: resolved.target.identity,
      document: {
        path: baseTarget,
        ...rendered,
        tree: addExternalDocumentAliasAnchors(rendered.tree, analysis),
        gitTree: null,
        graphNodeIds: {},
        tableOfContents: buildViewTableOfContents(
          sections,
          analysis.sections.map((section) => section.title),
          {
            errors: [],
            gitTree: null,
          },
        ),
        errors: [],
        backReferences: await renderExternalSectionBackReferences(
          referenceIndex,
          targetHeadings,
          latDir,
          projectRoot,
          createResolver,
        ),
        frontmatter: { requireCodeMention: false },
      },
    };
  }

  const references = await renderExternalSourceReferences(
    referenceIndex,
    resolved.target.identity,
    latDir,
    projectRoot,
    createResolver,
  );
  return {
    kind: 'source',
    target: resolved.target.identity,
    source: {
      path: `${resolved.target.handle}:${resolved.target.authoredPath}`,
      content: resolved.fullContent,
      highlightedLines: highlightSource(
        resolved.target.resolvedPath,
        resolved.fullContent,
      ),
      focus: resolved.target.fragment
        ? {
            symbol: resolved.target.fragment,
            kind: 'external',
            signature: resolved.signature ?? resolved.target.fragment,
            startLine: resolved.startLine,
            endLine: resolved.endLine,
          }
        : null,
      context: null,
      otherReferences: references,
    },
  };
}

async function readViewSource(
  latDir: string,
  projectRoot: string,
  requestedPath: string,
  requestedSymbol = '',
  requestedLine = 0,
): Promise<
  Omit<ViewSourceDocument, 'highlightedLines' | 'context' | 'otherReferences'>
> {
  if (
    !requestedPath ||
    requestedPath.includes('\\') ||
    isAbsolute(requestedPath) ||
    !isSourceFileExtension(extname(requestedPath))
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
    { latDir, runtime: new SourceParserRuntime() },
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
    latDir,
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
    highlightedLines: highlightSource(source.path, source.content),
    ...references,
  };
}
