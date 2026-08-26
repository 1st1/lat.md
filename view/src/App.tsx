import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import type {
  ViewDocument,
  ViewDocumentError,
  ViewError,
  ViewGraphNode,
  ViewIndex,
  ViewProjectChange,
  ViewSourceDocument,
} from '../../src/view/protocol';
import { FileTree } from './FileTree';
import { DocumentToc } from './DocumentToc';
import GraphView, { preloadViewGraph } from './GraphView';
import {
  documentPath,
  documentUrl,
  graphNode,
  graphUrl,
  historyScrollPosition,
  historyStateWithScroll,
  isSameMarkdownDocument,
  searchButtonAction,
  searchHistoryState,
  searchReturnTo,
  scrollToDocumentLocation,
  sourcePath,
  sourceSymbol,
  type ViewScrollPosition,
  viewRouteIdentity,
} from './navigation';
import { renderSectionBackReferences } from './section-back-references';
import { SearchPage } from './SearchPage';
import { sourceLineId, SourceView } from './SourceView';

type ViewRoute =
  | { kind: 'search' }
  | { kind: 'graph'; nodeId: string }
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
  | { kind: 'graph' }
  | { kind: 'markdown'; document: ViewDocument }
  | { kind: 'source'; source: ViewSourceDocument };

const NO_GIT_FILES = {};

function AppHeader({
  className,
  graphHref,
  gitEnabled,
  gitHasChanges,
  index,
  onGitToggle,
  onGraphNavigate,
  onNavigate,
  onSearchNavigate,
  route,
}: {
  className: string;
  graphHref: string;
  gitEnabled: boolean;
  gitHasChanges: boolean;
  index: ViewIndex | null;
  onGitToggle: () => void;
  onGraphNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  onSearchNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  route: ViewRoute | null;
}) {
  return (
    <div className={className}>
      <a
        className="brand"
        href={index ? documentUrl(index.entry) : '/'}
        onClick={index ? onNavigate : undefined}
      >
        lat<span>.md</span>
      </a>
      <div className="sidebar-actions">
        {route?.kind !== 'graph' && index?.git && (
          <button
            aria-label={`${gitEnabled ? 'Hide' : 'Show'} Git changes${gitHasChanges ? ', changes available' : ''}`}
            aria-pressed={gitEnabled}
            className="sidebar-git"
            data-has-changes={gitHasChanges || undefined}
            onClick={onGitToggle}
            title={`${gitEnabled ? 'Hide' : 'Show'} Git changes`}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="7" cy="5" r="2" />
              <circle cx="7" cy="19" r="2" />
              <circle cx="17" cy="9" r="2" />
              <path d="M7 7v10M9 15c5 0 8-1.5 8-4" />
            </svg>
          </button>
        )}
        {route?.kind !== 'graph' && (
          <a
            aria-current={route?.kind === 'search' ? 'page' : undefined}
            aria-label="Search"
            className="sidebar-search"
            href="/search"
            onClick={onSearchNavigate}
            title="Search"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
          </a>
        )}
        <a
          aria-current={route?.kind === 'graph' ? 'page' : undefined}
          aria-label="Graph"
          className="sidebar-graph"
          href={graphHref}
          onClick={onGraphNavigate}
          title="Graph"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="6" cy="7" r="2" />
            <circle cx="18" cy="6" r="2" />
            <circle cx="16" cy="18" r="2" />
            <circle cx="7" cy="17" r="2" />
            <path d="m8 7 8-1M17 8l-1 8M14 18l-5-1M8 9l7 7" />
          </svg>
        </a>
      </div>
    </div>
  );
}

function DocumentErrorPanel({
  errors,
  onNavigate,
}: {
  errors: ViewDocumentError[];
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <section
      aria-label="Validation errors"
      className="document-error-panel"
      id="document-errors"
    >
      <div className="document-error-header">Validation errors</div>
      <div className="document-error-list">
        {errors.map((error, index) => (
          <a
            className="document-error-item"
            href={`#${error.anchor}`}
            key={`${error.anchor}-${index}`}
            onClick={onNavigate}
          >
            <span className="document-error-location">Line {error.line}</span>
            <span className="document-error-message">{error.message}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

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
  const [projectChange, setProjectChange] = useState<ViewProjectChange>({
    generation: 0,
    markdownGeneration: 0,
  });
  const [error, setError] = useState('');
  const [gitEnabled, setGitEnabled] = useState(true);
  const [openErrorsFor, setOpenErrorsFor] = useState<string | null>(null);
  const [historyScroll, setHistoryScroll] = useState<ViewScrollPosition | null>(
    null,
  );
  const pageRef = useRef<ViewPage | null>(page);
  pageRef.current = page;
  const positionedLocation = useRef<string | null>(null);
  const routeLocation = useMemo(() => viewRouteIdentity(location), [location]);
  const route = useMemo<ViewRoute | null>(() => {
    const url = new URL(routeLocation, window.location.origin);
    if (url.pathname === '/search') return { kind: 'search' };
    if (url.pathname === '/graph') {
      return {
        kind: 'graph',
        nodeId: graphNode(url.search),
      };
    }
    const markdown = documentPath(url.pathname);
    if (markdown) return { kind: 'markdown', path: markdown };
    const source = sourcePath(url.pathname);
    if (source) {
      const query = new URLSearchParams(url.search);
      const parsedLine = Number(query.get('line'));
      const parsedFocusLine = Number(query.get('at'));
      return {
        kind: 'source',
        path: source,
        symbol: sourceSymbol(url.hash),
        from: query.get('from') ?? '',
        line: Number.isInteger(parsedLine) && parsedLine > 0 ? parsedLine : 0,
        at:
          Number.isInteger(parsedFocusLine) && parsedFocusLine > 0
            ? parsedFocusLine
            : 0,
      };
    }
    return null;
  }, [routeLocation]);
  const activePath = route?.kind === 'markdown' ? route.path : null;
  const gitHasChanges =
    Object.keys(index?.git?.files ?? NO_GIT_FILES).length > 0;
  const errorPanelKey =
    page?.kind === 'markdown'
      ? `${page.document.path}@${projectChange.generation}`
      : null;
  const errorsOpen = errorPanelKey !== null && openErrorsFor === errorPanelKey;
  const documentHtml = useMemo(
    () =>
      page?.kind === 'markdown'
        ? renderSectionBackReferences(
            gitEnabled && page.document.gitHtml
              ? page.document.gitHtml
              : page.document.html,
            page.document.backReferences,
          )
        : '',
    [gitEnabled, page],
  );
  const graphHref = useMemo(() => {
    if (route?.kind === 'markdown' && page?.kind === 'markdown') {
      let headingId = new URL(location, window.location.origin).hash.slice(1);
      try {
        headingId = decodeURIComponent(headingId);
      } catch {
        // A malformed fragment falls back to the document node.
      }
      return graphUrl(
        page.document.graphNodeIds[headingId] ??
          page.document.graphNodeIds[''] ??
          `document:${route.path}`,
      );
    }
    if (route?.kind === 'source') {
      return graphUrl(
        route.at > 0
          ? `code-ref:${route.path}:${route.at}`
          : `source:${route.path}${route.symbol ? `#${route.symbol}` : ''}`,
      );
    }
    return '/graph';
  }, [location, page, route]);
  const graphExitHref = index ? documentUrl(index.entry) : '/';

  useEffect(() => {
    void preloadViewGraph().catch(() => {
      // GraphView reports the error if the user opens it before a later retry.
    });
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      positionedLocation.current = null;
      setHistoryScroll(historyScrollPosition(event.state));
      const nextDocumentPath = documentPath(window.location.pathname);
      const preservesDocument =
        pageRef.current?.kind === 'markdown' &&
        pageRef.current.document.path === nextDocumentPath;
      if (window.location.pathname !== '/graph' && !preservesDocument) {
        setPage(null);
      }
      setLocation(currentLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const events = new EventSource('/api/events');
    const updateGeneration = (event: MessageEvent<string>) => {
      const change = JSON.parse(event.data) as ViewProjectChange;
      setProjectChange((current) => {
        const generation = Math.max(current.generation, change.generation);
        const markdownGeneration = Math.max(
          current.markdownGeneration,
          change.markdownGeneration,
        );
        return generation === current.generation &&
          markdownGeneration === current.markdownGeneration
          ? current
          : { generation, markdownGeneration };
      });
    };
    events.addEventListener('ready', updateGeneration);
    events.addEventListener('change', updateGeneration);
    return () => events.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<ViewIndex>('/api/index', controller.signal)
      .then(setIndex)
      .catch((reason: Error) => setError(reason.message));
    return () => controller.abort();
  }, [projectChange.generation]);

  useEffect(() => {
    if (!route) {
      setHistoryScroll(null);
      setError('This is not a document URL.');
      return;
    }

    if (route.kind === 'search' || route.kind === 'graph') {
      setError('');
      setPage({ kind: route.kind });
      return;
    }

    const controller = new AbortController();
    setError('');
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
      if (reason.name !== 'AbortError') {
        setHistoryScroll(null);
        setError(reason.message);
      }
    });
    return () => controller.abort();
  }, [projectChange.generation, route]);

  useEffect(() => {
    if (!page) return;
    window.document.title =
      page.kind === 'search'
        ? 'Search · lat.md'
        : page.kind === 'graph'
          ? 'Graph · lat.md'
          : page.kind === 'markdown'
            ? `${page.document.title} · lat.md`
            : `${page.source.focus?.symbol ?? page.source.path} · lat.md`;
  }, [page]);

  useLayoutEffect(() => {
    if (!page || positionedLocation.current === location) return;
    if (page.kind === 'search' || page.kind === 'graph') {
      if (historyScroll) return;
      window.scrollTo({ top: 0, behavior: 'instant' });
      positionedLocation.current = location;
      return;
    }
    if (historyScroll) {
      window.scrollTo({ ...historyScroll, behavior: 'instant' });
      positionedLocation.current = location;
      setHistoryScroll(null);
      return;
    }
    if (page.kind === 'markdown') {
      scrollToDocumentLocation(window.location.hash, {
        getElementById: (id) => window.document.getElementById(id),
        scrollTo: (options) => window.scrollTo(options),
      });
    } else {
      const line = page.source.focus?.startLine;
      if (line) {
        window.document
          .getElementById(sourceLineId(line))
          ?.scrollIntoView({ behavior: 'instant', block: 'center' });
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    }
    positionedLocation.current = location;
  }, [historyScroll, location, page]);

  function saveCurrentScroll(): void {
    window.history.replaceState(
      historyStateWithScroll(window.history.state, {
        left: window.scrollX,
        top: window.scrollY,
      }),
      '',
      currentLocation(),
    );
  }

  function navigate(url: URL): void {
    const returnTo = currentLocation();
    const preservesDocument =
      page?.kind === 'markdown' &&
      page.document.path === documentPath(url.pathname) &&
      isSameMarkdownDocument(new URL(window.location.href), url);
    saveCurrentScroll();
    const nextLocation = `${url.pathname}${url.search}${url.hash}`;
    if (nextLocation === currentLocation()) return;
    positionedLocation.current = null;
    setHistoryScroll(null);
    const state =
      url.pathname === '/search' && window.location.pathname !== '/search'
        ? searchHistoryState(returnTo)
        : null;
    window.history.pushState(state, '', url);
    if (!preservesDocument) setPage(null);
    setLocation(currentLocation());
  }

  function closeSearch(): void {
    if (searchReturnTo(window.history.state)) {
      saveCurrentScroll();
      window.history.back();
      return;
    }
    if (!index) {
      window.location.assign('/');
      return;
    }
    positionedLocation.current = null;
    setHistoryScroll(null);
    window.history.replaceState(null, '', documentUrl(index.entry));
    setPage(null);
    setLocation(currentLocation());
  }

  function switchView(url: URL): void {
    const nextLocation = `${url.pathname}${url.search}${url.hash}`;
    if (nextLocation === currentLocation()) return;
    positionedLocation.current = null;
    setHistoryScroll(null);
    window.history.replaceState(null, '', url);
    setPage(null);
    setLocation(currentLocation());
  }

  function selectGraphNode(nodeId: string): void {
    const next = graphUrl(nodeId);
    if (next === currentLocation()) return;
    window.history.replaceState(window.history.state, '', next);
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

  function onSearchToggleClick(event: MouseEvent<HTMLAnchorElement>): void {
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
    if (searchButtonAction(window.location.pathname) === 'close') {
      closeSearch();
      return;
    }
    navigate(new URL(event.currentTarget.href));
  }

  function onGraphToggleClick(event: MouseEvent<HTMLAnchorElement>): void {
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
    const url = new URL(event.currentTarget.href);
    if (window.location.pathname === '/graph') {
      switchView(url);
      return;
    }
    const from = currentLocation();
    void preloadViewGraph(projectChange.generation)
      .catch(() => null)
      .then(() => {
        if (currentLocation() === from) switchView(url);
      });
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

  if (route?.kind === 'graph') {
    const header = (selectedNode: ViewGraphNode | null) => (
      <AppHeader
        className="graph-header"
        graphHref={selectedNode?.url ?? graphExitHref}
        gitEnabled={gitEnabled}
        gitHasChanges={gitHasChanges}
        index={index}
        onGitToggle={() => setGitEnabled((enabled) => !enabled)}
        onGraphNavigate={onGraphToggleClick}
        onNavigate={onNavigationClick}
        onSearchNavigate={onSearchToggleClick}
        route={route}
      />
    );
    return (
      <div className="graph-shell">
        <GraphView
          generation={projectChange.generation}
          gitEnabled={gitEnabled}
          header={header}
          markdownGeneration={projectChange.markdownGeneration}
          onNavigate={navigate}
          onSelect={selectGraphNode}
          selectedNodeId={route.nodeId}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <AppHeader
          className="sidebar-header"
          graphHref={graphHref}
          gitEnabled={gitEnabled}
          gitHasChanges={gitHasChanges}
          index={index}
          onGitToggle={() => setGitEnabled((enabled) => !enabled)}
          onGraphNavigate={onGraphToggleClick}
          onNavigate={onNavigationClick}
          onSearchNavigate={onSearchToggleClick}
          route={route}
        />
        <nav aria-label="Markdown files">
          {index && (
            <FileTree
              activePath={activePath}
              errorCounts={index.errorCounts}
              files={index.files}
              gitFiles={
                gitEnabled ? (index.git?.files ?? NO_GIT_FILES) : NO_GIT_FILES
              }
              onNavigate={onNavigationClick}
            />
          )}
        </nav>
      </aside>

      <main
        className={historyScroll ? 'main restoring-history-scroll' : 'main'}
      >
        {error ? (
          <div className="state error" role="alert">
            <strong>Could not open this document</strong>
            <span>{error}</span>
          </div>
        ) : page?.kind === 'search' ? (
          <SearchPage
            onClose={closeSearch}
            onNavigate={onNavigationClick}
            onScrollRestored={() => {
              positionedLocation.current = location;
              setHistoryScroll(null);
            }}
            markdownGeneration={projectChange.markdownGeneration}
            restoreScroll={historyScroll}
          />
        ) : page?.kind === 'markdown' ? (
          <div className="document-layout">
            <div className="document-column">
              <div className="document-header">
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
                  {page.document.errors.length > 0 && (
                    <button
                      aria-controls="document-errors"
                      aria-expanded={errorsOpen}
                      className="document-error-toggle"
                      onClick={() =>
                        setOpenErrorsFor(errorsOpen ? null : errorPanelKey)
                      }
                      type="button"
                    >
                      {page.document.errors.length}{' '}
                      {page.document.errors.length === 1 ? 'error' : 'errors'}
                    </button>
                  )}
                </div>
                {errorsOpen && (
                  <DocumentErrorPanel
                    errors={page.document.errors}
                    onNavigate={onNavigationClick}
                  />
                )}
              </div>
              <article
                className="markdown"
                onClick={onDocumentClick}
                dangerouslySetInnerHTML={{ __html: documentHtml }}
              />
            </div>
            <DocumentToc
              items={page.document.tableOfContents}
              onNavigate={onNavigationClick}
            />
          </div>
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
