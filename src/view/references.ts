import { relative, resolve } from 'node:path';
import type { CodeRef } from '../code-refs.js';
import {
  buildFileIndex,
  buildSectionSlugIndex,
  flattenSections,
  resolveRef,
  type Section,
} from '../lattice-model.js';
import {
  analyzeMarkdownFile,
  type MarkdownFileAnalysis,
  type MarkdownParagraph,
} from '../markdown-analysis.js';
import { toPosix } from '../path.js';
import { renderMarkdown, type WikiLinkResolver } from './markdown.js';
import type {
  ViewCodeBackReference,
  ViewMarkdownBackReference,
  ViewSectionBackReference,
  ViewSectionBackReferences,
  ViewSourceReference,
} from './protocol.js';
import { viewSourceTarget } from './source-target.js';
import {
  documentUrl as routeDocumentUrl,
  rewriteDocumentLink,
} from './document-route.js';

export type SourceReferenceOrigin = {
  sectionId: string;
  line: number;
};

type ParagraphContent = MarkdownParagraph;

export type ViewParsedMarkdownFile = MarkdownFileAnalysis;

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

/** Parse one Markdown file once into every structure needed by the view store. */
export function parseViewMarkdownFile(
  absolutePath: string,
  content: string,
  latDir: string,
  projectRoot: string,
): ViewParsedMarkdownFile {
  return analyzeMarkdownFile(absolutePath, content, latDir, projectRoot);
}

function contextMarkdownLink(requestedPath: string, url: string): string {
  return rewriteDocumentLink(url, requestedPath);
}

function documentUrl(
  latDir: string,
  projectRoot: string,
  section: Section,
): string {
  const path = toPosix(
    relative(latDir, resolve(projectRoot, section.filePath)),
  );
  const fragment = section.githubSlug ? section.githubSlug : '';
  return routeDocumentUrl(path, fragment);
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
    destination = new URL(url, `http://lat.local/${encodedSourcePath}`);
  } catch {
    return null;
  }
  if (destination.origin !== 'http://lat.local') {
    return null;
  }

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
    file.paragraphs.find(
      (paragraph) => line >= paragraph.startLine && line <= paragraph.endLine,
    ) ?? {
      markdown: section.firstParagraph,
      startLine: line,
      endLine: line,
      text: section.firstParagraph,
    }
  );
}

/** Resolve cached outgoing occurrences into direct section and source indexes. */
export function buildViewReferenceIndex(
  markdownFiles: Iterable<ViewParsedMarkdownFile>,
  codeFiles: Iterable<ViewCodeReferenceFile>,
  allSections: Section[],
  resolveExternalTarget?: (target: string) => string | null,
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
      const externalTarget = resolveExternalTarget?.(ref.target);
      if (externalTarget) {
        addExternalReference(externalTarget, locationKey, reference);
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
      const externalTarget = resolveExternalTarget?.(ref.target);
      if (externalTarget) {
        addExternalReference(externalTarget, `code:${ref.file}:${ref.line}`, {
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
  const sections = new Map<
    string,
    {
      sectionId: string;
      references: Map<string, IndexedBackReference>;
    }
  >();
  for (const [target, headingId] of targets) {
    let section = sections.get(headingId);
    if (!section) {
      section = { sectionId: target, references: new Map() };
      sections.set(headingId, section);
    }
    const lowerTarget = target.toLowerCase();
    const indexed = [...index.externalByTarget]
      .filter(([candidate]) => candidate.toLowerCase() === lowerTarget)
      .flatMap(([, references]) => references);
    for (const reference of indexed) {
      const key =
        reference.kind === 'markdown'
          ? `markdown:${reference.sourcePath}:${reference.paragraph.startLine}`
          : `code:${reference.path}:${reference.line}`;
      if (!section.references.has(key)) section.references.set(key, reference);
    }
  }

  const result: ViewSectionBackReferences[] = [];
  for (const [headingId, section] of sections) {
    const references = await Promise.all(
      [...section.references.values()].map((reference) =>
        renderExternalReference(
          reference,
          latDir,
          projectRoot,
          createWikiLinkResolver,
        ),
      ),
    );
    result.push({ sectionId: section.sectionId, headingId, references });
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
        paragraphTree: rendered.paragraphTree,
        url: rendered.url,
      });
    } else {
      result.push({
        sectionId: `code:${rendered.path}:${rendered.line}`,
        breadcrumbs: [...rendered.path.split('/'), `line ${rendered.line}`],
        paragraph: rendered.snippet,
        paragraphTree: {
          version: 1,
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              children: [{ type: 'text', value: rendered.snippet }],
            },
          ],
        },
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
  const paragraphTree = (
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
  ).tree;
  return {
    kind: 'markdown',
    sectionId: reference.section.id,
    breadcrumbs: breadcrumbs(latDir, projectRoot, reference.section),
    paragraph: reference.paragraph.text,
    paragraphTree,
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
        paragraphTree: rendered.paragraphTree,
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
