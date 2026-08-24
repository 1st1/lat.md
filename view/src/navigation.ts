const DOCUMENT_PREFIX = '/docs/';

export function documentUrl(path: string): string {
  return `${DOCUMENT_PREFIX}${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function documentPath(pathname: string): string | null {
  if (!pathname.startsWith(DOCUMENT_PREFIX)) return null;
  try {
    return pathname
      .slice(DOCUMENT_PREFIX.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
  } catch {
    return null;
  }
}
