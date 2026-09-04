const DOCUMENT_PREFIX = '/';
const RESOURCE_PREFIX = '/resources/';
const MARKDOWN_EXTENSION = '.md';
const RESERVED_ROUTES = new Set([
  'api',
  'assets',
  'data',
  'code',
  'external',
  'resources',
  'graph',
  'search',
  'index.html',
]);

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodeDocumentPath(pathname: string): string | null {
  if (!pathname.startsWith(DOCUMENT_PREFIX)) return null;
  try {
    const segments = pathname
      .slice(DOCUMENT_PREFIX.length)
      .split('/')
      .map(decodeURIComponent);
    if (
      segments.some(
        (part) => !part || part === '.' || part === '..' || /[/\\]/.test(part),
      )
    )
      return null;
    return segments.join('/');
  } catch {
    return null;
  }
}

/** Fail explicitly when a document would shadow the UI or a generated file. */
export function validateDocumentRoutes(paths: readonly string[]): void {
  const files = new Set(paths);
  for (const path of paths) {
    if (documentPath(documentUrl(path)) !== path) {
      throw new Error(
        `Document path conflicts with a reserved UI route: ${path}`,
      );
    }
    const parts = path.split('/');
    if (
      parts.some((part) => part === 'index.html.md') ||
      parts.some((_, i) => i > 0 && files.has(parts.slice(0, i).join('/')))
    ) {
      throw new Error(`Document path conflicts with an exported file: ${path}`);
    }
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
  if (
    !path ||
    RESERVED_ROUTES.has(path.split('/')[0]!) ||
    path.endsWith('/index.html') ||
    path.toLowerCase().endsWith(MARKDOWN_EXTENSION)
  )
    return null;
  return `${path}${MARKDOWN_EXTENSION}`;
}

/** Resolve an explicit `.md` route to the raw Markdown file it requests. */
export function rawDocumentPath(pathname: string): string | null {
  const path = decodeDocumentPath(pathname);
  return path &&
    !RESERVED_ROUTES.has(path.split('/')[0]!) &&
    path.toLowerCase().endsWith(MARKDOWN_EXTENSION)
    ? path
    : null;
}

/** Build the browser route for a non-Markdown file stored in the vault. */
export function documentResourceUrl(path: string): string {
  return `${RESOURCE_PREFIX}${encodePath(path)}`;
}

/** Resolve a browser resource route to a safe vault-relative file path. */
export function documentResourcePath(pathname: string): string | null {
  if (!pathname.startsWith(RESOURCE_PREFIX)) return null;
  try {
    const segments = pathname
      .slice(RESOURCE_PREFIX.length)
      .split('/')
      .map(decodeURIComponent);
    if (
      segments.length === 0 ||
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('\\'),
      )
    ) {
      return null;
    }
    return segments.join('/');
  } catch {
    return null;
  }
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
  if (path) {
    return `${documentUrl(path)}${resolved.search}${resolved.hash}`;
  }
  const resourcePath = decodeDocumentPath(resolved.pathname);
  if (!resourcePath) return value;
  return `${documentResourceUrl(resourcePath)}${resolved.search}${resolved.hash}`;
}
