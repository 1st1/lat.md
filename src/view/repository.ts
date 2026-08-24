import { readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { listLatticeFiles } from '../lattice.js';
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

  const markdown = await readFile(resolve(filePath), 'utf-8');
  const rendered = await renderMarkdown(markdown, requestedPath);
  return { path: requestedPath, ...rendered };
}
