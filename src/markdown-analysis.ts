import { performance } from 'node:perf_hooks';
import { relative } from 'node:path';
import type { Definition, Paragraph, Root, RootContent, Nodes } from 'mdast';
import { visit } from 'unist-util-visit';
import {
  extractLinks,
  extractRefs,
  parseFrontmatter,
  parseSections,
} from './lattice.js';
import type { LatFrontmatter, MdLink, Ref, Section } from './lattice-model.js';
import { parse } from './parser.js';
import { toPosix } from './path.js';
import type { WikiLink } from './extensions/wiki-link/types.js';
import {
  analyzeLocalMarkdownDiagnostics,
  type LocalMarkdownDiagnostic,
} from './markdown-validation.js';

export type MarkdownParagraph = {
  markdown: string;
  startLine: number;
  endLine: number;
  text: string;
};

/** Source-positioned block facts; never retains the parser AST. */
export type MarkdownBlock = {
  type: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  language?: string;
  children: MarkdownBlock[];
};

function extractBlocks(tree: Root): MarkdownBlock[] {
  const block = (node: Nodes): MarkdownBlock | undefined => {
    if (
      node.position?.start.offset === undefined ||
      node.position?.end.offset === undefined
    )
      return;
    return {
      type: node.type,
      start: node.position.start.offset,
      end: node.position.end.offset,
      startLine: node.position.start.line,
      endLine: node.position.end.line,
      ...('lang' in node && node.lang ? { language: node.lang } : {}),
      children: [
        'list',
        'listItem',
        'blockquote',
        'table',
        'tableRow',
      ].includes(node.type)
        ? ('children' in node ? node.children : [])
            .map(block)
            .filter((item): item is MarkdownBlock => !!item)
        : [],
    };
  };
  return tree.children
    .map(block)
    .filter((item): item is MarkdownBlock => !!item);
}

export type MarkdownDestinationLink = {
  kind: 'image' | 'link';
  line: number;
  url: string;
};

export type MarkdownAnalysisTimings = {
  readMs: number;
  hashMs: number;
  cacheReadMs: number;
  cacheWriteMs: number;
  cacheStatus: 'disabled' | 'hit' | 'miss';
  parseMs: number;
  sectionsMs: number;
  refsMs: number;
  linksMs: number;
  paragraphsMs: number;
  frontmatterMs: number;
  indexEntriesMs: number;
  diagnosticsMs: number;
};

/** Serializable semantic facts extracted from one Markdown file. */
export type MarkdownFileAnalysis = {
  absolutePath: string;
  content: string;
  path: string;
  projectPath: string;
  frontmatter: LatFrontmatter;
  sections: Section[];
  headingTitles: string[];
  wikiRefs: Ref[];
  paragraphs: MarkdownParagraph[];
  blocks: MarkdownBlock[];
  markdownLinks: MarkdownDestinationLink[];
  validationLinks: MdLink[];
  indexEntries: string[];
  diagnostics: LocalMarkdownDiagnostic[];
  timings: MarkdownAnalysisTimings;
};

function elapsed<T>(work: () => T): [T, number] {
  const start = performance.now();
  return [work(), performance.now() - start];
}

function inlineText(node: RootContent | WikiLink): string {
  if (node.type === 'wikiLink') return node.data.alias ?? node.value;
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  if (!('children' in node) || !Array.isArray(node.children)) return '';
  return node.children
    .map((child) => inlineText(child as RootContent | WikiLink))
    .join('');
}

function extractParagraphs(content: string, tree: Root): MarkdownParagraph[] {
  const result: MarkdownParagraph[] = [];
  visit(tree, 'paragraph', (node: Paragraph) => {
    const startLine = node.position?.start.line;
    const endLine = node.position?.end.line;
    if (!startLine || !endLine) return;
    const text = inlineText(node).replace(/\s+/g, ' ').trim();
    const startOffset = node.position?.start.offset;
    const endOffset = node.position?.end.offset;
    result.push({
      markdown:
        startOffset === undefined || endOffset === undefined
          ? text
          : content.slice(startOffset, endOffset),
      startLine,
      endLine,
      text,
    });
  });
  return result;
}

function extractHeadingTitles(tree: Root): string[] {
  const titles: string[] = [];
  visit(tree, 'heading', (node) => {
    titles.push(inlineText(node));
  });
  return titles;
}

function extractDestinationLinks(tree: Root): MarkdownDestinationLink[] {
  const definitions = new Map<string, string>();
  visit(tree, 'definition', (node: Definition) => {
    definitions.set(node.identifier.toLowerCase(), node.url);
  });

  const links: MarkdownDestinationLink[] = [];
  visit(tree, (node) => {
    if (
      node.type !== 'link' &&
      node.type !== 'image' &&
      node.type !== 'linkReference' &&
      node.type !== 'imageReference'
    ) {
      return;
    }
    const line = node.position?.start.line;
    if (!line) return;
    const url =
      node.type === 'link' || node.type === 'image'
        ? node.url
        : definitions.get(node.identifier.toLowerCase());
    if (!url) return;
    links.push({
      kind:
        node.type === 'image' || node.type === 'imageReference'
          ? 'image'
          : 'link',
      line,
      url,
    });
  });
  return links;
}

function extractIndexEntries(content: string): string[] {
  const names = new Set<string>();
  const pattern = /^- \[\[([^\]]+?)(?:\|[^\]]+)?\]\]/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) names.add(match[1]);
  return [...names];
}

/**
 * Parse and analyze one Markdown document. The syntax tree is deliberately
 * confined to this call so callers and workers only exchange serializable facts.
 */
export function analyzeMarkdownFile(
  absolutePath: string,
  content: string,
  latDir: string,
  projectRoot: string,
): MarkdownFileAnalysis {
  const [tree, parseMs] = elapsed(() => parse(content));
  const [sections, sectionsMs] = elapsed(() =>
    parseSections(absolutePath, content, projectRoot, tree),
  );
  const [wikiRefs, refsMs] = elapsed(() =>
    extractRefs(absolutePath, content, projectRoot, tree),
  );
  const [validationLinks, linksMs] = elapsed(() => extractLinks(content, tree));
  const [[paragraphs, markdownLinks, headingTitles], paragraphsMs] = elapsed(
    () =>
      [
        extractParagraphs(content, tree),
        extractDestinationLinks(tree),
        extractHeadingTitles(tree),
      ] as const,
  );
  const [frontmatter, frontmatterMs] = elapsed(() => parseFrontmatter(content));
  const [indexEntries, indexEntriesMs] = elapsed(() =>
    extractIndexEntries(content),
  );
  const [diagnostics, diagnosticsMs] = elapsed(() =>
    analyzeLocalMarkdownDiagnostics(validationLinks, sections),
  );

  return {
    absolutePath,
    content,
    path: toPosix(relative(latDir, absolutePath)),
    projectPath: toPosix(relative(projectRoot, absolutePath)),
    frontmatter,
    sections,
    headingTitles,
    wikiRefs,
    paragraphs,
    blocks: extractBlocks(tree),
    markdownLinks,
    validationLinks,
    indexEntries,
    diagnostics,
    timings: {
      readMs: 0,
      hashMs: 0,
      cacheReadMs: 0,
      cacheWriteMs: 0,
      cacheStatus: 'disabled',
      parseMs,
      sectionsMs,
      refsMs,
      linksMs,
      paragraphsMs,
      frontmatterMs,
      indexEntriesMs,
      diagnosticsMs,
    },
  };
}
