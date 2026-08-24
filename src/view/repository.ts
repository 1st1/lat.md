import { readFile, realpath } from 'node:fs/promises';
import {
  basename,
  dirname,
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
} from '../lattice.js';
import { toPosix } from '../walk.js';
import type { ViewDocument, ViewIndex } from './protocol.js';
import { renderMarkdown } from './markdown.js';

export class ViewDocumentNotFoundError extends Error {}

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

async function markdownWikiLinkResolver(
  latDir: string,
): Promise<(target: string) => string | null> {
  const projectRoot = dirname(latDir);
  const sections = await loadAllSections(latDir, projectRoot);
  const flat = flattenSections(sections);
  const sectionIds = new Set(flat.map((section) => section.id.toLowerCase()));
  const fileIndex = buildFileIndex(sections);
  const slugIndex = buildSectionSlugIndex(sections);
  const byId = new Map(
    flat.map((section) => [section.id.toLowerCase(), section]),
  );

  return (target) => {
    const result = resolveRef(target, sectionIds, fileIndex, slugIndex);
    if (result.ambiguous) return null;

    const section = byId.get(result.resolved.toLowerCase());
    if (!section) return null;

    const absoluteFile = resolve(projectRoot, section.filePath);
    const file = toPosix(relative(latDir, absoluteFile));
    const fragment =
      target.includes('#') && section.githubSlug
        ? `#${encodeURIComponent(section.githubSlug)}`
        : '';
    return `${documentUrl(file)}${fragment}`;
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
    markdownWikiLinkResolver(latDir),
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
