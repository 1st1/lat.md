const DOCUMENT_PREFIX = '/docs/';
const SOURCE_PREFIX = '/code/';

type DocumentScroller = {
  getElementById: (id: string) => {
    scrollIntoView: (options: ScrollIntoViewOptions) => void;
  } | null;
  scrollTo: (options: ScrollToOptions) => void;
};

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

export function sourcePath(pathname: string): string | null {
  if (!pathname.startsWith(SOURCE_PREFIX)) return null;
  try {
    return pathname
      .slice(SOURCE_PREFIX.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
  } catch {
    return null;
  }
}

export function sourceSymbol(hash: string): string {
  if (!hash) return '';
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

export function searchQuery(search: string): string {
  return new URLSearchParams(search).get('q') ?? '';
}

export function searchUrl(query: string): string {
  if (!query) return '/search';
  const search = new URLSearchParams({ q: query });
  return `/search?${search}`;
}

const SEARCH_RETURN_KEY = 'latSearchReturnTo';

export function searchHistoryState(returnTo: string): Record<string, string> {
  return { [SEARCH_RETURN_KEY]: returnTo };
}

export function searchReturnTo(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const returnTo = (state as Record<string, unknown>)[SEARCH_RETURN_KEY];
  return typeof returnTo === 'string' && returnTo.startsWith('/')
    ? returnTo
    : null;
}

export function searchEscapeAction(query: string): 'clear' | 'close' {
  return query ? 'clear' : 'close';
}

/** Position a newly rendered document without leaving its content in motion. */
export function scrollToDocumentLocation(
  hash: string,
  scroller: DocumentScroller,
): void {
  if (!hash) {
    scroller.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }

  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // Leave malformed fragments untouched; they simply will not match.
  }
  scroller
    .getElementById(id)
    ?.scrollIntoView({ behavior: 'instant', block: 'start' });
}
