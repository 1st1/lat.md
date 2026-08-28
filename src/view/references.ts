import { relative, resolve } from 'node:path';
import type { Definition, Paragraph, Root, RootContent } from 'mdast';
import { visit } from 'unist-util-visit';
import type { CodeRef } from '../code-refs.js';
import {
  buildFileIndex,
  buildSectionSlugIndex,
  extractRefs,
  extractLinks,
  flattenSections,
  parseSections,
  resolveRef,
  type Ref,
  type MdLink,
  type Section,
} from '../lattice.js';
import { parse } from '../parser.js';
import { toPosix } from '../walk.js';
import type { WikiLink } from '../extensions/wiki-link/types.js';
import { renderMarkdown, type WikiLinkResolver } from './markdown.js';
import type {
  ViewCodeBackReference,
  ViewMarkdownBackReference,
  ViewSectionBackReference,
  ViewSectionBackReferences,
  ViewSourceReference,
} from './protocol.js';
import { viewSourceTarget } from './source-target.js';

export type SourceReferenceOrigin = {
  sectionId: string;
  line: number;
};

type ParagraphContent = {
  markdown: string;
  startLine: number;
  text: string;
};

type MarkdownLink = {
  kind: 'image' | 'link';
  line: number;
  url: string;
};

export type ViewParsedMarkdownFile = {
  absolutePath: string;
  content: string;
  path: string;
  projectPath: string;
  tree: Root;
  sections: Section[];
  wikiRefs: Ref[];
  paragraphs: Map<number, ParagraphContent>;
  markdownLinks: MarkdownLink[];
  validationLinks: MdLink[];
};

export type ViewCodeReferenceFile = {
  path: string;
  lines: string[];
  refs: CodeRef[];
};

type IndexedMarkdownReference = {
  kind: 'markdown';
  section: Section;
  sourcePath: string;
  line: number;
  paragraph: ParagraphContent;
  activeWikiLink?: string;
  activeMarkdownLink?: string;
};

type IndexedBackReference = IndexedMarkdownReference | ViewCodeBackReference;

export type ViewReferenceIndex = {
  incomingBySection: ReadonlyMap<string, readonly IndexedBackReference[]>;
  sourceByTarget: ReadonlyMap<string, readonly IndexedMarkdownReference[]>;
  sourceReferenceCounts: ReadonlyMap<string, number>;
  externalByTarget: ReadonlyMap<string, readonly IndexedBackReference[]>;
};

function inlineText(node: RootContent | WikiLink): string {
  if (node.type === 'wikiLink') return node.data.alias ?? node.value;
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  if (!('children' in node) || !Array.isArray(node.children)) return '';
  return node.children
    .map((child) => inlineText(child as RootContent | WikiLink))
    .join('');
}

function paragraphs(
  content: string,
  tree: Root,
): Map<number, ParagraphContent> {
  const byLine = new Map<number, ParagraphContent>();
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

function markdownLinks(tree: Root): MarkdownLink[] {
  const definitions = new Map<string, string>();
  visit(tree, 'definition', (node: Definition) => {
    definitions.set(node.identifier.toLowerCase(), node.url);
  });

  const links: MarkdownLink[] = [];
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
    if (url) {
      links.push({
        kind:
          node.type === 'image' || node.type === 'imageReference'
            ? 'image'
            : 'link',
        line,
        url,
      });
    }
  });
  return links;
}

/** Parse one Markdown file once into every structure needed by the view store. */
export function parseViewMarkdownFile(
  absolutePath: string,
  content: string,
  latDir: string,
  projectRoot: string,
): ViewParsedMarkdownFile {
  const tree = parse(content);
  return {
    absolutePath,
    content,
    path: toPosix(relative(latDir, absolutePath)),
    projectPath: toPosix(relative(projectRoot, absolutePath)),
    tree,
    sections: parseSections(absolutePath, content, projectRoot, tree),
    wikiRefs: extractRefs(absolutePath, content, projectRoot, tree),
    paragraphs: paragraphs(content, tree),
    markdownLinks: markdownLinks(tree),
    validationLinks: extractLinks(content, tree),
  };
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

export function linkedSection(
  url: string,
  sourcePath: string,
  sectionsByPath: ReadonlyMap<string, Section[]>,
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

function paragraphFor(
  file: ViewParsedMarkdownFile,
  section: Section,
  line: number,
): ParagraphContent {
  return (
    file.paragraphs.get(line) ?? {
      markdown: section.firstParagraph,
      startLine: line,
      text: section.firstParagraph,
    }
  );
}

/** Resolve cached outgoing occurrences into direct section and source indexes. */
export function buildViewReferenceIndex(
  markdownFiles: Iterable<ViewParsedMarkdownFile>,
  codeFiles: Iterable<ViewCodeReferenceFile>,
  allSections: Section[],
  isExternalTarget?: (target: string) => boolean,
): ViewReferenceIndex {
  const files = [...markdownFiles].sort((a, b) => a.path.localeCompare(b.path));
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
  for (const file of files) {
    sectionsByPath.set(file.path.toLowerCase(), flattenSections(file.sections));
  }

  const incoming = new Map<string, Map<string, IndexedBackReference>>();
  const sourceByTarget = new Map<
    string,
    Map<string, IndexedMarkdownReference>
  >();
  const externalByTarget = new Map<string, Map<string, IndexedBackReference>>();
  const addIncoming = (
    targetId: string,
    key: string,
    reference: IndexedBackReference,
  ) => {
    const target = targetId.toLowerCase();
    let references = incoming.get(target);
    if (!references) {
      references = new Map();
      incoming.set(target, references);
    }
    if (!references.has(key)) references.set(key, reference);
  };
  const addSourceReference = (
    target: string,
    key: string,
    reference: IndexedMarkdownReference,
  ) => {
    let references = sourceByTarget.get(target);
    if (!references) {
      references = new Map();
      sourceByTarget.set(target, references);
    }
    if (!references.has(key)) references.set(key, reference);
  };
  const addExternalReference = (
    target: string,
    key: string,
    reference: IndexedBackReference,
  ) => {
    let references = externalByTarget.get(target);
    if (!references) {
      references = new Map();
      externalByTarget.set(target, references);
    }
    if (!references.has(key)) references.set(key, reference);
  };

  for (const file of files) {
    const fileSections = flattenSections(file.sections).sort(
      (a, b) => a.startLine - b.startLine,
    );
    for (const ref of file.wikiRefs) {
      const section = sectionById.get(ref.fromSection.toLowerCase());
      if (!section) continue;
      const reference: IndexedMarkdownReference = {
        kind: 'markdown',
        section,
        sourcePath: file.path,
        line: ref.line,
        paragraph: paragraphFor(file, section, ref.line),
        activeWikiLink: ref.target,
      };
      const locationKey = `markdown:${section.filePath}:${reference.paragraph.startLine}`;
      if (isExternalTarget?.(ref.target)) {
        addExternalReference(ref.target, locationKey, reference);
      }
      const source = viewSourceTarget(ref.target);
      if (source) {
        addSourceReference(source.key, locationKey, reference);
        if (source.symbol) {
          addSourceReference(source.fileKey, locationKey, reference);
        }
      }

      const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
      if (
        resolved.ambiguous ||
        !sectionById.has(resolved.resolved.toLowerCase())
      ) {
        continue;
      }
      addIncoming(resolved.resolved, locationKey, reference);
    }

    for (const link of file.markdownLinks) {
      if (link.kind !== 'link') continue;
      const targetSection = linkedSection(link.url, file.path, sectionsByPath);
      if (!targetSection) continue;
      const section = fileSections
        .filter((candidate) => candidate.startLine <= link.line)
        .at(-1);
      if (!section) continue;
      const reference: IndexedMarkdownReference = {
        kind: 'markdown',
        section,
        sourcePath: file.path,
        line: link.line,
        paragraph: paragraphFor(file, section, link.line),
        activeMarkdownLink: link.url,
      };
      addIncoming(
        targetSection.id,
        `markdown:${section.filePath}:${reference.paragraph.startLine}`,
        reference,
      );
    }
  }

  for (const file of [...codeFiles].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    for (const ref of [...file.refs].sort((a, b) => a.line - b.line)) {
      if (isExternalTarget?.(ref.target)) {
        addExternalReference(ref.target, `code:${ref.file}:${ref.line}`, {
          kind: 'code',
          path: ref.file,
          line: ref.line,
          snippet: file.lines[ref.line - 1]?.trim() ?? '',
          url: sourceLineUrl(ref.file, ref.line),
        });
      }
      const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
      if (
        resolved.ambiguous ||
        !sectionById.has(resolved.resolved.toLowerCase())
      ) {
        continue;
      }
      addIncoming(resolved.resolved, `code:${ref.file}:${ref.line}`, {
        kind: 'code',
        path: ref.file,
        line: ref.line,
        snippet: file.lines[ref.line - 1]?.trim() ?? '',
        url: sourceLineUrl(ref.file, ref.line),
      });
    }
  }

  return {
    incomingBySection: new Map(
      [...incoming].map(([target, references]) => [
        target,
        [...references.values()],
      ]),
    ),
    sourceByTarget: new Map(
      [...sourceByTarget].map(([target, references]) => [
        target,
        [...references.values()],
      ]),
    ),
    sourceReferenceCounts: new Map(
      [...sourceByTarget].map(([target, references]) => [
        target,
        references.size,
      ]),
    ),
    externalByTarget: new Map(
      [...externalByTarget].map(([target, references]) => [
        target,
        [...references.values()],
      ]),
    ),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function renderExternalReference(
  reference: IndexedBackReference,
  latDir: string,
  projectRoot: string,
  createWikiLinkResolver?: (requestedPath: string) => Promise<WikiLinkResolver>,
): Promise<ViewSectionBackReference> {
  if (reference.kind === 'code') return reference;
  const resolver = createWikiLinkResolver
    ? await createWikiLinkResolver(reference.sourcePath)
    : undefined;
  return renderIndexedMarkdownReference(
    reference,
    latDir,
    projectRoot,
    resolver,
  );
}

/** Render exact local Markdown and code backlinks for external targets. */
export async function renderExternalSectionBackReferences(
  index: ViewReferenceIndex,
  targets: ReadonlyMap<string, string>,
  latDir: string,
  projectRoot: string,
  createWikiLinkResolver?: (requestedPath: string) => Promise<WikiLinkResolver>,
): Promise<ViewSectionBackReferences[]> {
  const result: ViewSectionBackReferences[] = [];
  for (const [target, headingId] of targets) {
    const indexed = index.externalByTarget.get(target) ?? [];
    if (indexed.length === 0) continue;
    const references = await Promise.all(
      indexed.map((reference) =>
        renderExternalReference(
          reference,
          latDir,
          projectRoot,
          createWikiLinkResolver,
        ),
      ),
    );
    result.push({ sectionId: target, headingId, references });
  }
  return result;
}

/** Adapt exact external backlinks to the source context presentation. */
export async function renderExternalSourceReferences(
  index: ViewReferenceIndex,
  target: string,
  latDir: string,
  projectRoot: string,
  createWikiLinkResolver?: (requestedPath: string) => Promise<WikiLinkResolver>,
): Promise<ViewSourceReference[]> {
  const indexed = index.externalByTarget.get(target) ?? [];
  const result: ViewSourceReference[] = [];
  for (const reference of indexed) {
    const rendered = await renderExternalReference(
      reference,
      latDir,
      projectRoot,
      createWikiLinkResolver,
    );
    if (rendered.kind === 'markdown') {
      result.push({
        sectionId: rendered.sectionId,
        breadcrumbs: rendered.breadcrumbs,
        paragraph: rendered.paragraph,
        paragraphHtml: rendered.paragraphHtml,
        url: rendered.url,
      });
    } else {
      result.push({
        sectionId: `code:${rendered.path}:${rendered.line}`,
        breadcrumbs: [...rendered.path.split('/'), `line ${rendered.line}`],
        paragraph: rendered.snippet,
        paragraphHtml: `<code>${escapeHtml(rendered.snippet)}</code>`,
        url: rendered.url,
      });
    }
  }
  return result;
}

async function renderIndexedMarkdownReference(
  reference: IndexedMarkdownReference,
  latDir: string,
  projectRoot: string,
  resolveWikiLink?: WikiLinkResolver,
): Promise<ViewMarkdownBackReference> {
  const paragraphHtml = (
    await renderMarkdown(
      reference.paragraph.markdown,
      reference.sourcePath,
      resolveWikiLink,
      {
        activeWikiLink: reference.activeWikiLink,
        activeMarkdownLink: reference.activeMarkdownLink,
        lineOffset: reference.paragraph.startLine - 1,
        rewriteMarkdownLink: (url) =>
          contextMarkdownLink(reference.sourcePath, url),
      },
    )
  ).html;
  return {
    kind: 'markdown',
    sectionId: reference.section.id,
    breadcrumbs: breadcrumbs(latDir, projectRoot, reference.section),
    paragraph: reference.paragraph.text,
    paragraphHtml,
    url: documentUrl(latDir, projectRoot, reference.section),
  };
}

/** Render direct reverse-index entries for the sections visible in one file. */
export async function renderSectionBackReferences(
  index: ViewReferenceIndex,
  visibleSections: Section[],
  latDir: string,
  projectRoot: string,
  createWikiLinkResolver?: (requestedPath: string) => Promise<WikiLinkResolver>,
): Promise<ViewSectionBackReferences[]> {
  const resolverByPath = new Map<string, Promise<WikiLinkResolver>>();
  const resolverFor = (path: string): Promise<WikiLinkResolver> => {
    let resolver = resolverByPath.get(path);
    if (!resolver) {
      resolver = createWikiLinkResolver
        ? createWikiLinkResolver(path)
        : Promise.resolve(async () => null);
      resolverByPath.set(path, resolver);
    }
    return resolver;
  };

  const result: ViewSectionBackReferences[] = [];
  for (const section of flattenSections(visibleSections)) {
    const indexed = index.incomingBySection.get(section.id.toLowerCase()) ?? [];
    if (indexed.length === 0) continue;
    const references: ViewSectionBackReference[] = [];
    for (const reference of indexed) {
      references.push(
        reference.kind === 'code'
          ? reference
          : await renderIndexedMarkdownReference(
              reference,
              latDir,
              projectRoot,
              await resolverFor(reference.sourcePath),
            ),
      );
    }
    result.push({
      sectionId: section.id,
      headingId: section.githubSlug ?? '',
      references,
    });
  }
  return result;
}

/** Render cached Markdown occurrences that point to one source target. */
export async function renderSourceReferenceContext(
  index: ViewReferenceIndex,
  target: string,
  origin: SourceReferenceOrigin | undefined,
  latDir: string,
  projectRoot: string,
  createWikiLinkResolver?: (requestedPath: string) => Promise<WikiLinkResolver>,
): Promise<{
  context: ViewSourceReference | null;
  otherReferences: ViewSourceReference[];
}> {
  const source = viewSourceTarget(target);
  const indexed = source ? (index.sourceByTarget.get(source.key) ?? []) : [];
  const resolverByPath = new Map<string, Promise<WikiLinkResolver>>();
  const located: { line: number; reference: ViewSourceReference }[] = [];

  for (const reference of indexed) {
    let resolver = resolverByPath.get(reference.sourcePath);
    if (!resolver) {
      resolver = createWikiLinkResolver
        ? createWikiLinkResolver(reference.sourcePath)
        : Promise.resolve(async () => null);
      resolverByPath.set(reference.sourcePath, resolver);
    }
    const rendered = await renderIndexedMarkdownReference(
      reference,
      latDir,
      projectRoot,
      await resolver,
    );
    located.push({
      line: reference.line,
      reference: {
        sectionId: rendered.sectionId,
        breadcrumbs: rendered.breadcrumbs,
        paragraph: rendered.paragraph,
        paragraphHtml: rendered.paragraphHtml,
        url: rendered.url,
      },
    });
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
