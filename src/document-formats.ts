/** Document formats that external sources can resolve by heading. */
export const DOCUMENT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.adoc',
  '.asciidoc',
  '.md',
  '.rst',
]);

export type DocumentFormat = 'asciidoc' | 'markdown' | 'restructuredtext';

export function documentFormat(path: string): DocumentFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.rst')) return 'restructuredtext';
  if (lower.endsWith('.adoc') || lower.endsWith('.asciidoc')) {
    return 'asciidoc';
  }
  return null;
}

export function isDocumentPath(path: string): boolean {
  return documentFormat(path) !== null;
}

export function stripDocumentExtension(path: string): string {
  const lower = path.toLowerCase();
  for (const extension of DOCUMENT_FILE_EXTENSIONS) {
    if (lower.endsWith(extension)) return path.slice(0, -extension.length);
  }
  return path;
}

export function documentFormatLabel(format: DocumentFormat): string {
  switch (format) {
    case 'asciidoc':
      return 'AsciiDoc';
    case 'markdown':
      return 'Markdown';
    case 'restructuredtext':
      return 'reStructuredText';
  }
}
