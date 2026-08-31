import { posix } from 'node:path';
import { performance } from 'node:perf_hooks';
import { flattenSections, type Section } from './lattice.js';
import { analyzeMarkdownFile } from './markdown-analysis.js';
import { documentFormat, type DocumentFormat } from './document-formats.js';
import type {
  ViewDocumentElement,
  ViewDocumentNode,
  ViewDocumentTree,
} from './view/protocol.js';
import {
  PARSER_CACHE_VERSION,
  hashParserContent,
  parsedCachePath,
  readParsedCache,
  writeParsedCache,
  type ParsedCacheEntry,
} from './parser-cache.js';

export type ExternalDocumentSection = {
  title: string;
  depth: number;
  anchor: string;
  aliases: string[];
  hierarchy: string[];
  startLine: number;
  endLine: number;
};

/** Serializable document facts retained after a format parser discards its AST. */
export type ExternalDocumentAnalysis = {
  format: DocumentFormat;
  title: string;
  sections: ExternalDocumentSection[];
};

export type ExternalDocumentCacheStatus = 'disabled' | 'hit' | 'miss';

export type ExternalDocumentAnalysisTimings = {
  hashMs: number;
  cacheReadMs: number;
  cacheWriteMs: number;
  parseMs: number;
  cacheStatus: ExternalDocumentCacheStatus;
};

export type ExternalDocumentFileAnalysis = {
  path: string;
  document: ExternalDocumentAnalysis;
  timings: ExternalDocumentAnalysisTimings;
};

export type AnalyzeExternalDocumentOptions = {
  identity?: string;
  cache?: boolean;
  runtime?: ExternalDocumentParserRuntime;
  onFileAnalyzed?: (analysis: ExternalDocumentFileAnalysis) => void;
};

type OpenSection = Omit<ExternalDocumentSection, 'endLine'>;

function unique(values: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
}

function closeSections(
  sections: OpenSection[],
  finalLine: number,
): ExternalDocumentSection[] {
  return sections.map((section, index) => {
    const next = sections
      .slice(index + 1)
      .find((candidate) => candidate.depth <= section.depth);
    return {
      ...section,
      endLine: next
        ? Math.max(section.startLine, next.startLine - 1)
        : finalLine,
    };
  });
}

function markdownAnalysis(
  path: string,
  content: string,
): ExternalDocumentAnalysis {
  const virtual = `/external/${path}`;
  const analysis = analyzeMarkdownFile(virtual, content, '/', '/');
  const parents: Array<{ depth: number; title: string }> = [];
  const sections = flattenSections(analysis.sections).map((section, index) => {
    const title = analysis.headingTitles[index] ?? section.heading;
    while (
      parents.length > 0 &&
      parents[parents.length - 1].depth >= section.depth
    ) {
      parents.pop();
    }
    const hierarchy = [...parents.map((parent) => parent.title), title];
    const legacyHierarchy = section.id.split('#').slice(1);
    parents.push({ depth: section.depth, title });
    return {
      title,
      depth: section.depth,
      anchor: section.githubSlug ?? '',
      aliases: unique([
        hierarchy.join('#'),
        legacyHierarchy.join('#'),
        title,
        section.heading,
        section.githubSlug,
      ]),
      hierarchy,
      startLine: section.startLine,
    };
  });
  return {
    format: 'markdown',
    title: analysis.headingTitles[0] ?? posix.basename(path, '.md'),
    sections: closeSections(sections, content.split('\n').length),
  };
}

async function restructuredTextAnalysis(
  path: string,
  content: string,
): Promise<ExternalDocumentAnalysis> {
  const { RstSection, RstToHtmlCompiler } = await import('rst-compiler');
  const compiler = new RstToHtmlCompiler();
  const parsed = compiler.parse(content, {
    disableErrors: true,
    disableWarnings: true,
  });
  const nodes = parsed.root
    .findAllChildren('Section')
    .filter((node): node is InstanceType<typeof RstSection> =>
      Boolean(node instanceof RstSection),
    );
  const aliasesByNode = new Map<object, string[]>();
  for (const [alias, node] of parsed.simpleNameResolver
    .nodesLinkableFromOutside) {
    const aliases = aliasesByNode.get(node) ?? [];
    aliases.push(alias);
    aliasesByNode.set(node, aliases);
  }
  const hierarchy: string[] = [];
  const sections = nodes.map((node) => {
    hierarchy.length = node.level - 1;
    hierarchy.push(node.textContent);
    const anchor = parsed.htmlAttrResolver.getNodeHtmlId(node) ?? '';
    return {
      title: node.textContent,
      depth: node.level,
      anchor,
      aliases: unique([
        hierarchy.join('#'),
        node.textContent,
        anchor,
        ...(aliasesByNode.get(node) ?? []),
      ]),
      hierarchy: [...hierarchy],
      startLine: node.source.startLineIdx + 1,
    };
  });
  return {
    format: 'restructuredtext',
    title: sections[0]?.title ?? posix.basename(path, '.rst'),
    sections: closeSections(sections, content.split('\n').length),
  };
}

/** Accept legacy AsciiDoc source listings whose delimiter lengths do not match. */
export function asciidocCompatibleContent(content: string): string {
  const lines = content.split('\n');
  for (let index = 0; index + 1 < lines.length; index++) {
    if (!/^\[(?:source|listing)(?:,|\])/i.test(lines[index].trim())) continue;
    if (!/^-{5,}\r?$/.test(lines[index + 1])) continue;
    for (let closing = index + 2; closing < lines.length; closing++) {
      if (!/^-{4,}\r?$/.test(lines[closing])) continue;
      const openingCr = lines[index + 1].endsWith('\r') ? '\r' : '';
      const closingCr = lines[closing].endsWith('\r') ? '\r' : '';
      lines[index + 1] = `----${openingCr}`;
      lines[closing] = `----${closingCr}`;
      index = closing;
      break;
    }
  }
  return lines.join('\n');
}

async function asciidocAnalysis(
  path: string,
  content: string,
): Promise<ExternalDocumentAnalysis> {
  const { load } = await import('@asciidoctor/core');
  const document = await load(asciidocCompatibleContent(content), {
    safe: 'secure',
    sourcemap: true,
    attributes: { showtitle: true },
  });
  const sections: OpenSection[] = [];
  const documentTitle = document.getTitle();
  const documentId = document.getId() ?? '';
  const rootHierarchy = documentTitle ? [documentTitle] : [];
  if (documentTitle) {
    sections.push({
      title: documentTitle,
      depth: 1,
      anchor: documentId,
      aliases: unique([documentTitle, documentId]),
      hierarchy: rootHierarchy,
      startLine: document.getLineNumber() ?? 1,
    });
  }
  const visit = (
    nodes: ReturnType<typeof document.getSections>,
    parents: string[],
  ): void => {
    for (const node of nodes) {
      const title = node.getTitle() ?? '';
      const hierarchy = [...parents, title];
      const anchor = node.getId() ?? '';
      const level = node.getLevel();
      sections.push({
        title,
        depth:
          level == null ? hierarchy.length : level + (documentTitle ? 1 : 0),
        anchor,
        aliases: unique([hierarchy.join('#'), title, anchor]),
        hierarchy,
        startLine: node.getLineNumber() ?? 1,
      });
      visit(node.getSections(), hierarchy);
    }
  };
  visit(document.getSections(), rootHierarchy);
  const extension = path.toLowerCase().endsWith('.asciidoc')
    ? '.asciidoc'
    : '.adoc';
  return {
    format: 'asciidoc',
    title:
      documentTitle ?? sections[0]?.title ?? posix.basename(path, extension),
    sections: closeSections(sections, content.split('\n').length),
  };
}

export async function analyzeExternalDocument(
  path: string,
  content: string,
): Promise<ExternalDocumentAnalysis> {
  switch (documentFormat(path)) {
    case 'markdown':
      return markdownAnalysis(path, content);
    case 'restructuredtext':
      return restructuredTextAnalysis(path, content);
    case 'asciidoc':
      return asciidocAnalysis(path, content);
    default:
      throw new Error(`unsupported external document format for "${path}"`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isExternalDocumentSection(
  value: unknown,
): value is ExternalDocumentSection {
  if (!isRecord(value)) return false;
  return (
    typeof value.title === 'string' &&
    Number.isInteger(value.depth) &&
    (value.depth as number) > 0 &&
    typeof value.anchor === 'string' &&
    isStringArray(value.aliases) &&
    isStringArray(value.hierarchy) &&
    Number.isInteger(value.startLine) &&
    (value.startLine as number) > 0 &&
    Number.isInteger(value.endLine) &&
    (value.endLine as number) >= (value.startLine as number)
  );
}

function cachedExternalDocumentAnalysis(
  entry: ParsedCacheEntry | null,
  contentHash: string,
  identity: string,
  timings: Omit<ExternalDocumentAnalysisTimings, 'cacheWriteMs' | 'parseMs'>,
): ExternalDocumentFileAnalysis | null {
  if (
    !entry ||
    entry.version !== PARSER_CACHE_VERSION ||
    entry.contentHash !== contentHash ||
    !isRecord(entry.value) ||
    entry.value.path !== identity ||
    !isRecord(entry.value.document) ||
    !['markdown', 'restructuredtext', 'asciidoc'].includes(
      String(entry.value.document.format),
    ) ||
    typeof entry.value.document.title !== 'string' ||
    !Array.isArray(entry.value.document.sections) ||
    !entry.value.document.sections.every(isExternalDocumentSection)
  ) {
    return null;
  }
  return {
    path: identity,
    document: entry.value.document as ExternalDocumentAnalysis,
    timings: {
      ...timings,
      cacheStatus: 'hit',
      cacheWriteMs: 0,
      parseMs: 0,
    },
  };
}

/** Request-scoped owner for external document parser work. */
export class ExternalDocumentParserRuntime {
  readonly analyses = new Map<string, Promise<ExternalDocumentFileAnalysis>>();

  clear(): void {
    this.analyses.clear();
  }
}

const defaultExternalDocumentParserRuntime =
  new ExternalDocumentParserRuntime();

/** Return the shared parsed-cache path for one external document identity. */
export function externalDocumentAnalysisCachePath(
  latDir: string,
  identity: string,
): string {
  return parsedCachePath(latDir, identity);
}

/** Analyze an external document through the shared persistent parser cache. */
export async function analyzeExternalDocumentCached(
  path: string,
  content: string,
  latDir: string,
  options: AnalyzeExternalDocumentOptions = {},
): Promise<ExternalDocumentFileAnalysis> {
  const identity = (options.identity ?? path)
    .replaceAll('\\', '/')
    .normalize('NFC');
  const hashStarted = performance.now();
  const contentHash = hashParserContent(content);
  const hashMs = performance.now() - hashStarted;
  const cache = options.cache !== false;
  const cachePath = externalDocumentAnalysisCachePath(latDir, identity);
  const promiseKey = `${cache ? 'cache' : 'direct'}\0${cachePath}\0${contentHash}`;
  const runtime = options.runtime ?? defaultExternalDocumentParserRuntime;
  let analysis = runtime.analyses.get(promiseKey);
  const created = !analysis;
  if (!analysis) {
    analysis = (async () => {
      const cacheStarted = performance.now();
      const entry = cache ? await readParsedCache(cachePath) : null;
      const cacheReadMs = cache ? performance.now() - cacheStarted : 0;
      const timings = {
        hashMs,
        cacheReadMs,
        cacheStatus: cache ? ('miss' as const) : ('disabled' as const),
      };
      const cached = cache
        ? cachedExternalDocumentAnalysis(entry, contentHash, identity, timings)
        : null;
      if (cached) return cached;

      const parseStarted = performance.now();
      const document = await analyzeExternalDocument(path, content);
      const result: ExternalDocumentFileAnalysis = {
        path: identity,
        document,
        timings: {
          ...timings,
          cacheWriteMs: 0,
          parseMs: performance.now() - parseStarted,
        },
      };
      if (!cache) return result;

      const writeStarted = performance.now();
      try {
        await writeParsedCache(cachePath, contentHash, result);
      } catch {
        // Parsed caches are disposable; document resolution must work read-only.
      }
      result.timings.cacheWriteMs = performance.now() - writeStarted;
      return result;
    })();
    runtime.analyses.set(promiseKey, analysis);
  }
  const result = await analysis;
  if (created) options.onFileAnalyzed?.(result);
  return result;
}

export function findExternalDocumentSection(
  analysis: ExternalDocumentAnalysis,
  fragment: string,
): ExternalDocumentSection | undefined {
  const wanted = fragment.toLowerCase();
  return analysis.sections.find((section) =>
    section.aliases.some((alias) => alias.toLowerCase() === wanted),
  );
}

/** Project format-neutral document sections into the existing browser TOC model. */
export function externalDocumentSections(
  path: string,
  analysis: ExternalDocumentAnalysis,
): Section[] {
  const roots: Section[] = [];
  const parents: Section[] = [];
  for (const source of analysis.sections) {
    const section: Section = {
      id: `${path}#${source.hierarchy.join('#')}`,
      heading: source.title,
      depth: source.depth,
      file: path,
      filePath: path,
      children: [],
      startLine: source.startLine,
      endLine: source.endLine,
      firstParagraph: '',
      githubSlug: source.anchor,
    };
    while (
      parents.length > 0 &&
      parents[parents.length - 1].depth >= section.depth
    ) {
      parents.pop();
    }
    const parent = parents[parents.length - 1];
    if (parent) parent.children.push(section);
    else roots.push(section);
    parents.push(section);
  }
  return roots;
}

/** Add zero-size alias anchors to the normalized external document tree. */
export function addExternalDocumentAliasAnchors(
  source: ViewDocumentTree,
  analysis: ExternalDocumentAnalysis,
): ViewDocumentTree {
  const tree = structuredClone(source);
  const canonical = new Set(
    analysis.sections.map((section) => section.anchor).filter(Boolean),
  );
  for (const section of analysis.sections) {
    if (!section.anchor) continue;
    const aliases = section.aliases.filter(
      (alias) => alias !== section.anchor && !canonical.has(alias),
    );
    if (aliases.length === 0) continue;
    const insert = (children: ViewDocumentNode[]): boolean => {
      for (let index = 0; index < children.length; index++) {
        const node = children[index];
        if (node.type !== 'element') continue;
        if (
          /^h[1-6]$/.test(node.tagName) &&
          node.properties.id === section.anchor
        ) {
          const anchors: ViewDocumentElement[] = aliases.map((alias) => ({
            type: 'element',
            tagName: 'span',
            properties: { id: alias, ariaHidden: 'true' },
            children: [],
          }));
          children.splice(index, 0, ...anchors);
          return true;
        }
        if (insert(node.children)) return true;
      }
      return false;
    };
    insert(tree.children);
  }
  return tree;
}
