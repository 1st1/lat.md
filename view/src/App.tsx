import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type {
  ViewDocument,
  ViewError,
  ViewIndex,
  ViewSourceDocument,
} from '../../src/view/protocol';
import { FileTree } from './FileTree';
import {
  documentPath,
  documentUrl,
  searchHistoryState,
  searchReturnTo,
  scrollToDocumentLocation,
  sourcePath,
  sourceSymbol,
} from './navigation';
import { renderSectionBackReferences } from './section-back-references';
import { SearchPage } from './SearchPage';
import { sourceLineId, SourceView } from './SourceView';

type ViewRoute =
  | { kind: 'search' }
  | { kind: 'markdown'; path: string }
  | {
      kind: 'source';
      path: string;
      symbol: string;
      from: string;
      line: number;
      at: number;
    };

type ViewPage =
  | { kind: 'search' }
  | { kind: 'markdown'; document: ViewDocument }
  | { kind: 'source'; source: ViewSourceDocument };

async function fetchJson<T extends object>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal });
  const value = (await response.json()) as T | ViewError;
  if (!response.ok) {
    throw new Error('error' in value ? value.error : 'Request failed');
  }
  return value as T;
}

function currentLocation(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function App() {
  const [location, setLocation] = useState(currentLocation);
  const [index, setIndex] = useState<ViewIndex | null>(null);
  const [page, setPage] = useState<ViewPage | null>(null);
  const [error, setError] = useState('');
  const route = useMemo<ViewRoute | null>(() => {
    if (window.location.pathname === '/search') return { kind: 'search' };
    const markdown = documentPath(window.location.pathname);
    if (markdown) return { kind: 'markdown', path: markdown };
    const source = sourcePath(window.location.pathname);
    if (source) {
      const query = new URLSearchParams(window.location.search);
      const parsedLine = Number(query.get('line'));
      const parsedFocusLine = Number(query.get('at'));
      return {
        kind: 'source',
        path: source,
        symbol: sourceSymbol(window.location.hash),
        from: query.get('from') ?? '',
        line: Number.isInteger(parsedLine) && parsedLine > 0 ? parsedLine : 0,
        at:
          Number.isInteger(parsedFocusLine) && parsedFocusLine > 0
            ? parsedFocusLine
            : 0,
      };
    }
    return null;
  }, [location]);
  const activePath = route?.kind === 'markdown' ? route.path : null;
  const documentHtml = useMemo(
    () =>
      page?.kind === 'markdown'
        ? renderSectionBackReferences(
            page.document.html,
            page.document.backReferences,
          )
        : '',
    [page],
  );

  useEffect(() => {
    const onPopState = () => setLocation(currentLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<ViewIndex>('/api/index', controller.signal)
      .then(setIndex)
      .catch((reason: Error) => setError(reason.message));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!route) {
      setError('This is not a document URL.');
      return;
    }

    if (route.kind === 'search') {
      setError('');
      setPage({ kind: 'search' });
      return;
    }

    const controller = new AbortController();
    setError('');
    setPage(null);
    const request =
      route.kind === 'markdown'
        ? fetchJson<ViewDocument>(
            `/api/document?path=${encodeURIComponent(route.path)}`,
            controller.signal,
          ).then((document) => setPage({ kind: 'markdown', document }))
        : fetchJson<ViewSourceDocument>(
            `/api/source?path=${encodeURIComponent(route.path)}&symbol=${encodeURIComponent(route.symbol)}&from=${encodeURIComponent(route.from)}&line=${route.line}&at=${route.at}`,
            controller.signal,
          ).then((source) => setPage({ kind: 'source', source }));
    request.catch((reason: Error) => {
      if (reason.name !== 'AbortError') setError(reason.message);
    });
    return () => controller.abort();
  }, [route]);

  useEffect(() => {
    if (!page) return;
    window.document.title =
      page.kind === 'search'
        ? 'Search · lat.md'
        : page.kind === 'markdown'
          ? `${page.document.title} · lat.md`
          : `${page.source.focus?.symbol ?? page.source.path} · lat.md`;
    requestAnimationFrame(() => {
      if (page.kind === 'search') {
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
      }
      if (page.kind === 'markdown') {
        scrollToDocumentLocation(window.location.hash, {
          getElementById: (id) => window.document.getElementById(id),
          scrollTo: (options) => window.scrollTo(options),
        });
        return;
      }
      const line = page.source.focus?.startLine;
      if (line) {
        window.document
          .getElementById(sourceLineId(line))
          ?.scrollIntoView({ behavior: 'instant', block: 'center' });
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    });
  }, [page, location]);

  function navigate(url: URL): void {
    const state =
      url.pathname === '/search' && window.location.pathname !== '/search'
        ? searchHistoryState(currentLocation())
        : null;
    window.history.pushState(state, '', url);
    setLocation(currentLocation());
  }

  function closeSearch(): void {
    if (searchReturnTo(window.history.state)) {
      window.history.back();
      return;
    }
    if (!index) {
      window.location.assign('/');
      return;
    }
    window.history.replaceState(null, '', documentUrl(index.entry));
    setLocation(currentLocation());
  }

  function onNavigationClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(new URL(event.currentTarget.href));
  }

  function onDocumentClick(event: MouseEvent<HTMLElement>): void {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target;
    const toggle =
      target instanceof Element
        ? target.closest<HTMLButtonElement>('[data-section-back-references]')
        : null;
    if (toggle) {
      const panelId = toggle.getAttribute('aria-controls');
      const panel = panelId ? window.document.getElementById(panelId) : null;
      if (panel) {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        panel.hidden = open;
      }
      return;
    }
    const anchor =
      target instanceof Element ? target.closest<HTMLAnchorElement>('a') : null;
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;

    const url = new URL(anchor.href, window.location.href);
    if (
      url.origin !== window.location.origin ||
      (!documentPath(url.pathname) && !sourcePath(url.pathname))
    ) {
      return;
    }

    event.preventDefault();
    navigate(url);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <a
            className="brand"
            href={index ? documentUrl(index.entry) : '/'}
            onClick={index ? onNavigationClick : undefined}
          >
            lat<span>.md</span>
          </a>
          <a
            aria-current={route?.kind === 'search' ? 'page' : undefined}
            aria-label="Search"
            className="sidebar-search"
            href="/search"
            onClick={onNavigationClick}
            title="Search"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
          </a>
        </div>
        <nav aria-label="Markdown files">
          {index && (
            <FileTree
              activePath={activePath}
              files={index.files}
              onNavigate={onNavigationClick}
            />
          )}
        </nav>
      </aside>

      <main className="main">
        {page?.kind === 'markdown' && (
          <div className="document-metadata">
            <div className="document-path">{page.document.path}</div>
            {page.document.frontmatter.requireCodeMention && (
              <div
                className="document-flag"
                title="Every leaf section must have an @lat code reference"
              >
                Code mentions required
              </div>
            )}
          </div>
        )}
        {error ? (
          <div className="state error" role="alert">
            <strong>Could not open this document</strong>
            <span>{error}</span>
          </div>
        ) : page?.kind === 'search' ? (
          <SearchPage onClose={closeSearch} onNavigate={onNavigationClick} />
        ) : page?.kind === 'markdown' ? (
          <article
            className="markdown"
            onClick={onDocumentClick}
            dangerouslySetInnerHTML={{ __html: documentHtml }}
          />
        ) : page?.kind === 'source' ? (
          <SourceView
            key={`${page.source.path}#${page.source.focus?.symbol ?? ''}@${page.source.focus?.startLine ?? 0}`}
            onContentClick={onDocumentClick}
            source={page.source}
          />
        ) : (
          <div className="state">Loading…</div>
        )}
      </main>
    </div>
  );
}
