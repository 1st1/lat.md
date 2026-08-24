import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { Definition, Paragraph, RootContent } from 'mdast';
import { visit } from 'unist-util-visit';
import { scanCodeRefs } from '../code-refs.js';
import {
  buildFileIndex,
  buildSectionSlugIndex,
  extractRefs,
  flattenSections,
  listLatticeFiles,
  loadAllSections,
  resolveRef,
  type Section,
} from '../lattice.js';
import { parse } from '../parser.js';
import { toPosix } from '../walk.js';
import type { WikiLink } from '../extensions/wiki-link/types.js';
import { renderMarkdown, type WikiLinkResolver } from './markdown.js';
import type {
  ViewSectionBackReference,
  ViewSectionBackReferences,
  ViewSourceReference,
} from './protocol.js';

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

type MarkdownLink = {
  line: number;
  url: string;
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

function markdownLinks(content: string): MarkdownLink[] {
  const tree = parse(content);
  const definitions = new Map<string, string>();
  visit(tree, 'definition', (node: Definition) => {
    definitions.set(node.identifier.toLowerCase(), node.url);
  });

  const links: MarkdownLink[] = [];
  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'linkReference') return;
    const line = node.position?.start.line;
    if (!line) return;
    const url =
      node.type === 'link'
        ? node.url
        : definitions.get(node.identifier.toLowerCase());
    if (url) links.push({ line, url });
  });
  return links;
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

function sourceLineUrl(path: string, line: number): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `/code/${encoded}?at=${line}`;
}

function linkedSection(
  url: string,
  sourcePath: string,
  sectionsByPath: Map<string, Section[]>,
): Section | null {
  if (url.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(url)) return null;
  const encodedSourcePath = sourcePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  let destination: URL;
  try {
    destination = new URL(url, `http://lat.local/docs/${encodedSourcePath}`);
  } catch {
    return null;
  }
  if (
    destination.origin !== 'http://lat.local' ||
    !destination.pathname.startsWith('/docs/')
  ) {
    return null;
  }

  let path: string;
  let fragment: string;
  try {
    path = destination.pathname
      .slice('/docs/'.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
    fragment = decodeURIComponent(destination.hash.slice(1));
  } catch {
    return null;
  }
  const sections = sectionsByPath.get(path.toLowerCase());
  if (!sections) return null;
  if (!fragment) return sections[0] ?? null;
  return (
    sections.find(
      (section) => section.githubSlug?.toLowerCase() === fragment.toLowerCase(),
    ) ?? null
  );
}

/** Collect the Markdown and code locations that point to this document's sections. */
export async function getSectionBackReferences(
  latDir: string,
  projectRoot: string,
  requestedPath: string,
  allSections: Section[],
  createWikiLinkResolver?: (requestedPath: string) => Promise<WikiLinkResolver>,
): Promise<ViewSectionBackReferences[]> {
  const sections = flattenSections(allSections);
  const sectionIds = new Set(
    sections.map((section) => section.id.toLowerCase()),
  );
  const fileIndex = buildFileIndex(allSections);
  const slugIndex = buildSectionSlugIndex(allSections);
  const sectionById = new Map(
    sections.map((section) => [section.id.toLowerCase(), section]),
  );
  const sectionsByPath = new Map<string, Section[]>();
  const sectionsByFile = new Map<string, Section[]>();
  for (const section of sections) {
    const path = toPosix(
      relative(latDir, resolve(projectRoot, section.filePath)),
    ).toLowerCase();
    const byPath = sectionsByPath.get(path) ?? [];
    byPath.push(section);
    sectionsByPath.set(path, byPath);

    const byFile = sectionsByFile.get(section.filePath) ?? [];
    byFile.push(section);
    sectionsByFile.set(section.filePath, byFile);
  }
  const currentFile = toPosix(
    relative(projectRoot, resolve(latDir, requestedPath)),
  );
  const visibleSections = sections.filter(
    (section) => section.filePath === currentFile,
  );
  const referencesByTarget = new Map<
    string,
    Map<string, ViewSectionBackReference>
  >(visibleSections.map((section) => [section.id.toLowerCase(), new Map()]));

  for (const file of await listLatticeFiles(latDir)) {
    const content = await readFile(file, 'utf-8');
    const refs = extractRefs(file, content, projectRoot);
    if (refs.length === 0) continue;

    const paragraphByLine = paragraphs(content);
    const sourcePath = toPosix(relative(latDir, file));
    const sourceFile = toPosix(relative(projectRoot, file));
    let resolveWikiLink: WikiLinkResolver | undefined;
    const renderedParagraphs = new Map<string, string>();
    for (const ref of refs) {
      const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
      if (resolved.ambiguous) continue;
      const references = referencesByTarget.get(
        resolved.resolved.toLowerCase(),
      );
      if (!references) continue;

      const fromSection = sectionById.get(ref.fromSection.toLowerCase());
      if (!fromSection) continue;
      const paragraph = paragraphByLine.get(ref.line) ?? {
        markdown: fromSection.firstParagraph,
        startLine: ref.line,
        text: fromSection.firstParagraph,
      };
      const key = `markdown:${fromSection.filePath}:${paragraph.startLine}`;
      if (references.has(key)) continue;

      const renderedKey = `${paragraph.startLine}:${ref.target.toLowerCase()}`;
      let paragraphHtml = renderedParagraphs.get(renderedKey);
      if (!paragraphHtml) {
        if (!resolveWikiLink && createWikiLinkResolver) {
          resolveWikiLink = await createWikiLinkResolver(sourcePath);
        }
        paragraphHtml = (
          await renderMarkdown(
            paragraph.markdown,
            sourcePath,
            resolveWikiLink,
            {
              activeWikiLink: ref.target,
              lineOffset: paragraph.startLine - 1,
              rewriteMarkdownLink: (url) =>
                contextMarkdownLink(sourcePath, url),
            },
          )
        ).html;
        renderedParagraphs.set(renderedKey, paragraphHtml);
      }
      references.set(key, {
        kind: 'markdown',
        sectionId: fromSection.id,
        breadcrumbs: breadcrumbs(latDir, projectRoot, fromSection),
        paragraph: paragraph.text,
        paragraphHtml,
        url: documentUrl(latDir, projectRoot, fromSection),
      });
    }

    for (const link of markdownLinks(content)) {
      const targetSection = linkedSection(link.url, sourcePath, sectionsByPath);
      if (!targetSection) continue;
      const references = referencesByTarget.get(targetSection.id.toLowerCase());
      if (!references) continue;

      const fromSection = sectionsByFile
        .get(sourceFile)
        ?.filter((section) => section.startLine <= link.line)
        .at(-1);
      if (!fromSection) continue;
      const paragraph = paragraphByLine.get(link.line) ?? {
        markdown: fromSection.firstParagraph,
        startLine: link.line,
        text: fromSection.firstParagraph,
      };
      const key = `markdown:${fromSection.filePath}:${paragraph.startLine}`;
      if (references.has(key)) continue;

      const renderedKey = `${paragraph.startLine}:markdown:${link.url}`;
      let paragraphHtml = renderedParagraphs.get(renderedKey);
      if (!paragraphHtml) {
        if (!resolveWikiLink && createWikiLinkResolver) {
          resolveWikiLink = await createWikiLinkResolver(sourcePath);
        }
        paragraphHtml = (
          await renderMarkdown(
            paragraph.markdown,
            sourcePath,
            resolveWikiLink,
            {
              activeMarkdownLink: link.url,
              lineOffset: paragraph.startLine - 1,
              rewriteMarkdownLink: (url) =>
                contextMarkdownLink(sourcePath, url),
            },
          )
        ).html;
        renderedParagraphs.set(renderedKey, paragraphHtml);
      }
      references.set(key, {
        kind: 'markdown',
        sectionId: fromSection.id,
        breadcrumbs: breadcrumbs(latDir, projectRoot, fromSection),
        paragraph: paragraph.text,
        paragraphHtml,
        url: documentUrl(latDir, projectRoot, fromSection),
      });
    }
  }

  const codeLines = new Map<string, string[]>();
  const { refs: codeRefs } = await scanCodeRefs(projectRoot);
  for (const ref of codeRefs) {
    const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
    if (resolved.ambiguous) continue;
    const references = referencesByTarget.get(resolved.resolved.toLowerCase());
    if (!references) continue;

    const key = `code:${ref.file}:${ref.line}`;
    if (references.has(key)) continue;
    let lines = codeLines.get(ref.file);
    if (!lines) {
      try {
        lines = (await readFile(resolve(projectRoot, ref.file), 'utf-8')).split(
          '\n',
        );
      } catch {
        continue;
      }
      codeLines.set(ref.file, lines);
    }
    references.set(key, {
      kind: 'code',
      path: ref.file,
      line: ref.line,
      snippet: lines[ref.line - 1]?.trim() ?? '',
      url: sourceLineUrl(ref.file, ref.line),
    });
  }

  return visibleSections.flatMap((section) => {
    const references = [
      ...(referencesByTarget.get(section.id.toLowerCase())?.values() ?? []),
    ];
    return references.length > 0
      ? [
          {
            sectionId: section.id,
            headingId: section.githubSlug ?? '',
            references,
          },
        ]
      : [];
  });
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
