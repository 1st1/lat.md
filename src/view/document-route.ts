const DOCUMENT_PREFIX = '/docs/';
const MARKDOWN_EXTENSION = '.md';

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodeDocumentPath(pathname: string): string | null {
  if (!pathname.startsWith(DOCUMENT_PREFIX)) return null;
  try {
    const path = pathname
      .slice(DOCUMENT_PREFIX.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
    return path && !path.endsWith('/') ? path : null;
  } catch {
    return null;
  }
}

/** Build the canonical, extensionless browser route for a Markdown file. */
export function documentUrl(path: string, fragment = ''): string {
  const routePath = path.endsWith(MARKDOWN_EXTENSION)
    ? path.slice(0, -MARKDOWN_EXTENSION.length)
    : path;
  return `${DOCUMENT_PREFIX}${encodePath(routePath)}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
}

/** Resolve an extensionless browser route back to its Markdown file path. */
export function documentPath(pathname: string): string | null {
  const path = decodeDocumentPath(pathname);
  if (!path || path.toLowerCase().endsWith(MARKDOWN_EXTENSION)) return null;
  return `${path}${MARKDOWN_EXTENSION}`;
}

/** Resolve an explicit `.md` route to the raw Markdown file it requests. */
export function rawDocumentPath(pathname: string): string | null {
  const path = decodeDocumentPath(pathname);
  return path?.toLowerCase().endsWith(MARKDOWN_EXTENSION) ? path : null;
}

/** Keep relative Markdown-to-Markdown links inside the rendered document UI. */
export function rewriteDocumentLink(value: string, sourcePath: string): string {
  if (
    !value ||
    value.startsWith('#') ||
    value.startsWith('/') ||
    value.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  ) {
    return value;
  }

  let resolved: URL;
  try {
    resolved = new URL(
      value,
      `http://lat.local${DOCUMENT_PREFIX}${encodePath(sourcePath)}`,
    );
  } catch {
    return value;
  }
  if (resolved.origin !== 'http://lat.local') return value;
  const path = rawDocumentPath(resolved.pathname);
  if (!path) return value;
  return `${documentUrl(path)}${resolved.search}${resolved.hash}`;
}
