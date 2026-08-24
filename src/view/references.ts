import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { Paragraph, RootContent } from 'mdast';
import { visit } from 'unist-util-visit';
import {
  extractRefs,
  flattenSections,
  listLatticeFiles,
  loadAllSections,
  type Section,
} from '../lattice.js';
import { parse } from '../parser.js';
import { toPosix } from '../walk.js';
import type { WikiLink } from '../extensions/wiki-link/types.js';
import { renderMarkdown, type WikiLinkResolver } from './markdown.js';
import type { ViewSourceReference } from './protocol.js';

export type SourceReferenceOrigin = {
  sectionId: string;
  line: number;
};

type LocatedReference = {
  line: number;
  reference: ViewSourceReference;
};

type ParagraphContent = {
  markdown: string;
  startLine: number;
  text: string;
};

function inlineText(node: RootContent | WikiLink): string {
  if (node.type === 'wikiLink') {
    return node.data.alias ?? node.value;
  }
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  if (!('children' in node) || !Array.isArray(node.children)) return '';
  return node.children
    .map((child) => inlineText(child as RootContent | WikiLink))
    .join('');
}

function paragraphs(content: string): Map<number, ParagraphContent> {
  const byLine = new Map<number, ParagraphContent>();
  const tree = parse(content);
  visit(tree, 'paragraph', (node: Paragraph) => {
    const start = node.position?.start.line;
    const end = node.position?.end.line;
    if (!start || !end) return;
    const text = inlineText(node).replace(/\s+/g, ' ').trim();
    const startOffset = node.position?.start.offset;
    const endOffset = node.position?.end.offset;
    const paragraph = {
      markdown:
        startOffset === undefined || endOffset === undefined
          ? text
          : content.slice(startOffset, endOffset),
      startLine: start,
      text,
    };
    for (let line = start; line <= end; line++) byLine.set(line, paragraph);
  });
  return byLine;
}

function contextMarkdownLink(requestedPath: string, url: string): string {
  if (
    url.startsWith('/') ||
    url.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(url)
  ) {
    return url;
  }
  const encodedPath = requestedPath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const resolved = new URL(url, `http://lat.local/docs/${encodedPath}`);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function documentUrl(
  latDir: string,
  projectRoot: string,
  section: Section,
): string {
  const path = toPosix(
    relative(latDir, resolve(projectRoot, section.filePath)),
  );
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const fragment = section.githubSlug
    ? `#${encodeURIComponent(section.githubSlug)}`
    : '';
  return `/docs/${encoded}${fragment}`;
}

function breadcrumbs(
  latDir: string,
  projectRoot: string,
  section: Section,
): string[] {
  const path = toPosix(
    relative(latDir, resolve(projectRoot, section.filePath)),
  ).replace(/\.md$/i, '');
  return [...path.split('/'), ...section.id.split('#').slice(1)];
}

/** Resolve the clicked paragraph and other lat sections for a source target. */
export async function getSourceReferenceContext(
  latDir: string,
  projectRoot: string,
  target: string,
  origin?: SourceReferenceOrigin,
  createWikiLinkResolver?: (requestedPath: string) => Promise<WikiLinkResolver>,
): Promise<{
  context: ViewSourceReference | null;
  otherReferences: ViewSourceReference[];
}> {
  const sections = flattenSections(await loadAllSections(latDir, projectRoot));
  const sectionById = new Map(
    sections.map((section) => [section.id.toLowerCase(), section]),
  );
  const located: LocatedReference[] = [];

  for (const file of await listLatticeFiles(latDir)) {
    const content = await readFile(file, 'utf-8');
    const matchingRefs = extractRefs(file, content, projectRoot).filter(
      (ref) => ref.target.toLowerCase() === target.toLowerCase(),
    );
    if (matchingRefs.length === 0) continue;

    const paragraphByLine = paragraphs(content);
    const requestedPath = toPosix(relative(latDir, file));
    const resolveWikiLink = createWikiLinkResolver
      ? await createWikiLinkResolver(requestedPath)
      : undefined;
    const renderedParagraphs = new Map<number, string>();
    for (const ref of matchingRefs) {
      const section = sectionById.get(ref.fromSection.toLowerCase());
      if (!section) continue;
      const paragraph = paragraphByLine.get(ref.line) ?? {
        markdown: section.firstParagraph,
        startLine: ref.line,
        text: section.firstParagraph,
      };
      let paragraphHtml = renderedParagraphs.get(paragraph.startLine);
      if (!paragraphHtml) {
        paragraphHtml = (
          await renderMarkdown(
            paragraph.markdown,
            requestedPath,
            resolveWikiLink,
            {
              activeWikiLink: target,
              lineOffset: paragraph.startLine - 1,
              rewriteMarkdownLink: (url) =>
                contextMarkdownLink(requestedPath, url),
            },
          )
        ).html;
        renderedParagraphs.set(paragraph.startLine, paragraphHtml);
      }
      located.push({
        line: ref.line,
        reference: {
          sectionId: section.id,
          breadcrumbs: breadcrumbs(latDir, projectRoot, section),
          paragraph: paragraph.text,
          paragraphHtml,
          url: documentUrl(latDir, projectRoot, section),
        },
      });
    }
  }

  const context = origin
    ? (located.find(
        (candidate) =>
          candidate.line === origin.line &&
          candidate.reference.sectionId.toLowerCase() ===
            origin.sectionId.toLowerCase(),
      )?.reference ?? null)
    : null;
  const otherSections = new Map<string, ViewSourceReference>();
  for (const candidate of located) {
    const key = candidate.reference.sectionId.toLowerCase();
    if (context && key === context.sectionId.toLowerCase()) continue;
    if (!otherSections.has(key)) otherSections.set(key, candidate.reference);
  }

  return { context, otherReferences: [...otherSections.values()] };
}
