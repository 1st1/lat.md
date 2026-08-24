const DOCUMENT_PREFIX = '/docs/';

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
