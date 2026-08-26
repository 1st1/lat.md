import { staticViewRoute, viewPathname } from './static-mode';

const DOCUMENT_PREFIX = '/docs/';
const SOURCE_PREFIX = '/code/';

type DocumentScroller = {
  getElementById: (id: string) => {
    scrollIntoView: (options: ScrollIntoViewOptions) => void;
  } | null;
  scrollTo: (options: ScrollToOptions) => void;
};

export function documentUrl(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return staticViewRoute(`docs/${encoded}/`) ?? `${DOCUMENT_PREFIX}${encoded}`;
}

export function documentPath(pathname: string): string | null {
  pathname = viewPathname(pathname);
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

/** Keep Markdown route identity stable when only its fragment changes. */
export function viewRouteIdentity(location: string): string {
  const url = new URL(location, 'http://lat.local');
  return documentPath(url.pathname)
    ? `${url.pathname}${url.search}`
    : `${url.pathname}${url.search}${url.hash}`;
}

/** Whether navigation stays within one rendered Markdown document. */
export function isSameMarkdownDocument(current: URL, next: URL): boolean {
  return (
    documentPath(current.pathname) !== null &&
    current.origin === next.origin &&
    current.pathname === next.pathname &&
    current.search === next.search
  );
}

export function sourcePath(pathname: string): string | null {
  pathname = viewPathname(pathname);
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

export function graphNode(search: string): string {
  return new URLSearchParams(search).get('node') ?? '';
}

export function graphUrl(nodeId = ''): string {
  const path = staticViewRoute('graph/') ?? '/graph';
  if (!nodeId) return path;
  const search = new URLSearchParams({ node: nodeId });
  return `${path}?${search}`;
}

const SEARCH_RETURN_KEY = 'latSearchReturnTo';
const SCROLL_POSITION_KEY = 'latScrollPosition';

export type ViewScrollPosition = {
  left: number;
  top: number;
};

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

export function historyStateWithScroll(
  state: unknown,
  position: ViewScrollPosition,
): Record<string, unknown> {
  const current =
    state && typeof state === 'object' && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : {};
  return { ...current, [SCROLL_POSITION_KEY]: position };
}

export function historyScrollPosition(
  state: unknown,
): ViewScrollPosition | null {
  if (!state || typeof state !== 'object') return null;
  const position = (state as Record<string, unknown>)[SCROLL_POSITION_KEY];
  if (!position || typeof position !== 'object') return null;
  const { left, top } = position as Record<string, unknown>;
  return typeof left === 'number' &&
    Number.isFinite(left) &&
    typeof top === 'number' &&
    Number.isFinite(top)
    ? { left, top }
    : null;
}

export function searchEscapeAction(query: string): 'clear' | 'close' {
  return query ? 'clear' : 'close';
}

export function searchButtonAction(pathname: string): 'close' | 'open' {
  return pathname === '/search' ? 'close' : 'open';
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
