import {
  lazy,
  Suspense,
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
  ViewExternalDocument,
  ViewGraphNode,
  ViewIndex,
  ViewProjectChange,
  ViewSourceDocument,
} from '../../src/view/protocol';
import { DEFAULT_VIEW_LOGO_TEXT } from '../../src/view/protocol';
import latLogoUrl from '../../website/public/logo.svg?url';
import { FileTree } from './FileTree';
import { MarkdownContent } from './MarkdownContent';
import { DocumentModeSwitch, type DocumentMode } from './DocumentModeSwitch';
import { DocumentToc } from './DocumentToc';
import { fetchViewJson } from './data-source';
import GraphView, { preloadViewGraph } from './GraphView';
import { mergeProjectChange } from './live-updates';
import {
  documentPath,
  documentUrl,
  externalTarget,
  graphModeStorageKey,
  graphNode,
  graphNodeIdForUrl,
  graphTarget,
  historyScrollPosition,
  historyStateWithScroll,
  isSameRenderedDocument,
  readGraphMode,
  searchButtonAction,
  searchHistoryState,
  searchReturnTo,
  scrollToDocumentLocation,
  sourcePath,
  sourceSymbol,
  type ViewScrollPosition,
  viewRouteIdentity,
  writeGraphMode,
} from './navigation';
import { navigateAndCopySectionLink } from './section-back-references';
import { SearchPage } from './SearchPage';
import { SectionOutputDialog } from './SectionOutputDialog';
import { sourceLineId, SourceView } from './SourceView';
import {
  isStaticView,
  staticViewAssetUrl,
  staticViewBasePath,
  viewPathname,
} from './static-mode';
import {
  blockUnsavedChangesUnload,
  confirmDiscardUnsavedChanges,
} from './unsaved-changes';

const MarkdownEditor = lazy(() => import('./MarkdownEditor'));

type ViewRoute =
  | { kind: 'search' }
  | { kind: 'graph'; nodeId: string; target: string }
  | { kind: 'markdown'; path: string }
  | { kind: 'external'; target: string }
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

function BrandText({ text }: { text: string }) {
  const suffix = '.md';
  if (!text.endsWith(suffix)) return text;
  return (
    <>
      {text.slice(0, -suffix.length)}
      <span>{suffix}</span>
    </>
  );
}

function AppHeader({
  className,
  graphActive,
  graphHref,
  gitEnabled,
  gitHasChanges,
  index,
  onGitToggle,
  onGraphNavigate,
  onNavigate,
  onSearchNavigate,
  route,
  searchEnabled,
}: {
  className: string;
  graphActive: boolean;
  graphHref: string;
  gitEnabled: boolean;
  gitHasChanges: boolean;
  index: ViewIndex | null;
  onGitToggle: () => void;
  onGraphNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  onSearchNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  route: ViewRoute | null;
  searchEnabled: boolean;
}) {
  const brandText = index?.logoText ?? DEFAULT_VIEW_LOGO_TEXT;

  return (
    <div className={className}>
      <a
        className="brand"
        href={index ? documentUrl(index.entry) : '/'}
        onClick={index ? onNavigate : undefined}
        title={brandText}
      >
        {brandText === DEFAULT_VIEW_LOGO_TEXT ? (
          <img
            alt={DEFAULT_VIEW_LOGO_TEXT}
            className="brand-logo"
            src={staticViewAssetUrl(latLogoUrl)}
          />
        ) : (
          <BrandText text={brandText} />
        )}
      </a>
      <div className="sidebar-actions">
        {!graphActive && index?.git && (
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
        {!graphActive && searchEnabled && (
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
          aria-current={graphActive ? 'page' : undefined}
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

function MobileNavigationTrigger({
  label,
  onToggle,
  open,
}: {
  label: string;
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <button
      aria-controls="mobile-file-navigation"
      aria-expanded={open}
      className="mobile-navigation-trigger"
      onClick={onToggle}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        {open ? (
          <>
            <path d="M6 6l12 12" />
            <path d="M18 6 6 18" />
          </>
        ) : (
          <>
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </>
        )}
      </svg>
      <span className="mobile-navigation-context">
        <span>Files</span>
        <span aria-hidden="true">›</span>
        <span className="mobile-navigation-current">{label}</span>
      </span>
    </button>
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

function currentLocation(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function App() {
  const staticView = isStaticView();
  const graphModeKey = graphModeStorageKey(staticViewBasePath());
  const [location, setLocation] = useState(currentLocation);
  const [index, setIndex] = useState<ViewIndex | null>(null);
  const [page, setPage] = useState<ViewPage | null>(null);
  const [projectChange, setProjectChange] = useState<ViewProjectChange>({
    instanceId: staticView ? 'static' : '',
    generation: 0,
    markdownGeneration: 0,
  });
  const [error, setError] = useState('');
  const [indexError, setIndexError] = useState('');
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [requestRevision, setRequestRevision] = useState(0);
  const [gitEnabled, setGitEnabled] = useState(true);
  const [graphMode, setGraphMode] = useState(() => {
    try {
      return (
        readGraphMode(window.localStorage, graphModeKey) ||
        viewPathname(window.location.pathname) === '/graph'
      );
    } catch {
      return viewPathname(window.location.pathname) === '/graph';
    }
  });
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [openErrorsFor, setOpenErrorsFor] = useState<string | null>(null);
  const [sectionOutputId, setSectionOutputId] = useState<string | null>(null);
  const [documentMode, setDocumentMode] = useState<DocumentMode>('view');
  const [historyScroll, setHistoryScroll] = useState<ViewScrollPosition | null>(
    null,
  );
  const pageRef = useRef<ViewPage | null>(page);
  pageRef.current = page;
  const documentDirty = useRef(false);
  const acceptedLocation = useRef(currentLocation());
  const pageRequestId = useRef(0);
  const positionedLocation = useRef<string | null>(null);
  const routeLocation = useMemo(() => viewRouteIdentity(location), [location]);
  const route = useMemo<ViewRoute | null>(() => {
    const url = new URL(routeLocation, window.location.origin);
    const pathname = viewPathname(url.pathname);
    if (pathname === '/search') return { kind: 'search' };
    if (pathname === '/graph') {
      return {
        kind: 'graph',
        nodeId: graphNode(url.search),
        target: graphTarget(url.search),
      };
    }
    const markdown = documentPath(url.pathname);
    if (markdown) return { kind: 'markdown', path: markdown };
    const external = externalTarget(url.pathname, url.hash);
    if (external) return { kind: 'external', target: external.identity };
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
  const graphActive =
    graphMode &&
    route !== null &&
    (route.kind === 'graph' ||
      route.kind === 'markdown' ||
      route.kind === 'source' ||
      route.kind === 'external');
  const graphSelectionTarget =
    route?.kind === 'graph' ? route.target : location;
  const graphSelectedNodeId =
    route?.kind === 'graph'
      ? route.nodeId
      : graphNodeIdForUrl(
          new URL(location, window.location.origin),
          route?.kind === 'external' && page?.kind === 'markdown'
            ? 'document'
            : route?.kind === 'external' && page?.kind === 'source'
              ? 'source'
              : undefined,
        );
  const activePath = route?.kind === 'markdown' ? route.path : null;
  const editingDocument =
    !staticView && route?.kind === 'markdown' && documentMode === 'edit';
  const activeExternalTarget = route?.kind === 'external' ? route.target : null;
  const gitHasChanges =
    Object.keys(index?.git?.files ?? NO_GIT_FILES).length > 0;
  const errorPanelKey =
    page?.kind === 'markdown'
      ? `${page.document.path}@${projectChange.generation}`
      : null;
  const errorsOpen = errorPanelKey !== null && openErrorsFor === errorPanelKey;
  const documentTree = useMemo(
    () =>
      page?.kind === 'markdown'
        ? gitEnabled && page.document.gitTree
          ? page.document.gitTree
          : page.document.tree
        : null,
    [gitEnabled, page],
  );
  const mobileNavigationLabel =
    route?.kind === 'markdown' || route?.kind === 'source'
      ? route.path
      : route?.kind === 'external'
        ? route.target
        : route?.kind === 'search'
          ? 'Search'
          : 'Files';

  useEffect(() => {
    void preloadViewGraph().catch(() => {
      // GraphView reports the error if the user opens it before a later retry.
    });
  }, []);

  useEffect(() => {
    if (route?.kind !== 'graph') return;
    let target = route.target;
    try {
      const url = new URL(target, window.location.origin);
      if (
        url.origin !== window.location.origin ||
        (!documentPath(url.pathname) &&
          !sourcePath(url.pathname) &&
          !externalTarget(url.pathname, url.hash))
      ) {
        target = '';
      } else {
        target = `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      target = '';
    }
    if (!target && index) target = documentUrl(index.entry);
    if (!target) return;
    setPersistedGraphMode(true);
    window.history.replaceState(window.history.state, '', target);
    pageRequestId.current++;
    setPage(null);
    setLocation(currentLocation());
  }, [index, route]);

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [routeLocation]);

  useEffect(() => {
    setDocumentMode('view');
    documentDirty.current = false;
  }, [activePath]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      blockUnsavedChangesUnload(documentDirty.current, event);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const body = window.document.body;
    const navigation = window.document.getElementById('mobile-file-navigation');
    const activeLink = navigation?.querySelector<HTMLElement>(
      '.document-link.active',
    );
    body.classList.add('mobile-navigation-open');
    (activeLink ?? navigation)?.focus({ preventScroll: true });
    activeLink?.scrollIntoView({ block: 'center', behavior: 'instant' });

    const desktop = window.matchMedia('(min-width: 64rem)');
    const closeForDesktop = () => {
      if (desktop.matches) setMobileNavigationOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileNavigationOpen(false);
      window.document
        .querySelector<HTMLElement>('.mobile-navigation-trigger')
        ?.focus();
    };
    desktop.addEventListener('change', closeForDesktop);
    window.addEventListener('keydown', closeForEscape);
    return () => {
      body.classList.remove('mobile-navigation-open');
      desktop.removeEventListener('change', closeForDesktop);
      window.removeEventListener('keydown', closeForEscape);
    };
  }, [mobileNavigationOpen]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const previousLocation = acceptedLocation.current;
      const nextLocation = currentLocation();
      const nextDocumentPath = documentPath(window.location.pathname);
      const nextExternal = externalTarget(
        window.location.pathname,
        window.location.hash,
      );
      const preservesDocument =
        pageRef.current?.kind === 'markdown' &&
        (pageRef.current.document.path === nextDocumentPath ||
          pageRef.current.document.path ===
            (nextExternal
              ? `${nextExternal.handle}:${nextExternal.path}`
              : null));
      if (
        !preservesDocument &&
        !confirmDiscardUnsavedChanges(
          documentDirty.current,
          window.confirm.bind(window),
        )
      ) {
        window.history.pushState(null, '', previousLocation);
        return;
      }
      if (!preservesDocument) documentDirty.current = false;
      acceptedLocation.current = nextLocation;
      positionedLocation.current = null;
      setHistoryScroll(historyScrollPosition(event.state));
      if (
        viewPathname(window.location.pathname) !== '/graph' &&
        !preservesDocument
      ) {
        pageRequestId.current++;
        setPage(null);
      }
      setLocation(currentLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (staticView) return;
    const events = new EventSource('/api/events');
    const updateGeneration = (event: MessageEvent<string>) => {
      try {
        const change = JSON.parse(event.data) as ViewProjectChange;
        if (
          typeof change.instanceId !== 'string' ||
          !Number.isInteger(change.generation) ||
          !Number.isInteger(change.markdownGeneration)
        ) {
          return;
        }
        setProjectChange((current) => mergeProjectChange(current, change));
      } catch {
        // Ignore a malformed event; EventSource remains connected.
      }
    };
    const serverReady = (event: MessageEvent<string>) => {
      updateGeneration(event);
      setConnectionRevision((value) => value + 1);
    };
    events.addEventListener('ready', serverReady);
    events.addEventListener('change', updateGeneration);
    return () => events.close();
  }, [staticView]);

  useEffect(() => {
    const controller = new AbortController();
    fetchViewJson<ViewIndex>('/api/index', controller.signal)
      .then((nextIndex) => {
        setIndex(nextIndex);
        setIndexError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setIndexError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [connectionRevision, projectChange.generation]);

  useEffect(() => {
    const requestId = ++pageRequestId.current;
    if (!route) {
      setHistoryScroll(null);
      setPage(null);
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
    const request: Promise<ViewPage> =
      route.kind === 'markdown'
        ? fetchViewJson<ViewDocument>(
            `/api/document?path=${encodeURIComponent(route.path)}`,
            controller.signal,
          ).then((document) => ({ kind: 'markdown', document }))
        : route.kind === 'external'
          ? fetchViewJson<ViewExternalDocument>(
              `/api/external?target=${encodeURIComponent(route.target)}`,
              controller.signal,
            ).then((external) =>
              external.kind === 'markdown'
                ? ({
                    kind: 'markdown',
                    document: external.document,
                  } satisfies ViewPage)
                : ({
                    kind: 'source',
                    source: external.source,
                  } satisfies ViewPage),
            )
          : fetchViewJson<ViewSourceDocument>(
              `/api/source?path=${encodeURIComponent(route.path)}&symbol=${encodeURIComponent(route.symbol)}&from=${encodeURIComponent(route.from)}&line=${route.line}&at=${route.at}`,
              controller.signal,
            ).then((source) => ({ kind: 'source', source }));
    request
      .then((nextPage) => {
        if (requestId !== pageRequestId.current) return;
        setPage(nextPage);
        setError('');
      })
      .catch((reason: unknown) => {
        if (requestId === pageRequestId.current && !controller.signal.aborted) {
          setPage(null);
          setHistoryScroll(null);
          setError(errorMessage(reason));
        }
      });
    return () => controller.abort();
  }, [connectionRevision, projectChange.generation, requestRevision, route]);

  useEffect(() => {
    if (!page) return;
    window.document.title = graphActive
      ? 'Graph · lat.md'
      : page.kind === 'search'
        ? 'Search · lat.md'
        : page.kind === 'graph'
          ? 'Graph · lat.md'
          : page.kind === 'markdown'
            ? `${page.document.title} · lat.md`
            : `${page.source.focus?.symbol ?? page.source.path} · lat.md`;
  }, [graphActive, page]);

  useLayoutEffect(() => {
    if (!page || positionedLocation.current === location) return;
    if (graphActive) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      positionedLocation.current = location;
      setHistoryScroll(null);
      return;
    }
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
      scrollToDocumentLocation(
        window.location.hash,
        {
          getElementById: (id) => window.document.getElementById(id),
          scrollTo: (options) => window.scrollTo(options),
        },
        page.document.tableOfContents.find((item) => item.depth === 1)?.id,
      );
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
  }, [graphActive, historyScroll, location, page]);

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

  function setPersistedGraphMode(enabled: boolean): void {
    setGraphMode(enabled);
    try {
      writeGraphMode(window.localStorage, graphModeKey, enabled);
    } catch {
      // Storage can be unavailable; the in-memory mode still works.
    }
  }

  function navigate(url: URL): void {
    const returnTo = currentLocation();
    const preservesDocument =
      page?.kind === 'markdown' &&
      (page.document.path === documentPath(url.pathname) ||
        page.document.path ===
          (() => {
            const external = externalTarget(url.pathname, url.hash);
            return external ? `${external.handle}:${external.path}` : null;
          })()) &&
      isSameRenderedDocument(new URL(window.location.href), url);
    const nextLocation = `${url.pathname}${url.search}${url.hash}`;
    if (nextLocation === currentLocation()) {
      if (!page || error) retryPage();
      return;
    }
    if (
      !preservesDocument &&
      !confirmDiscardUnsavedChanges(
        documentDirty.current,
        window.confirm.bind(window),
      )
    ) {
      return;
    }
    if (!preservesDocument) documentDirty.current = false;
    saveCurrentScroll();
    positionedLocation.current = null;
    setHistoryScroll(null);
    const state =
      url.pathname === '/search' && window.location.pathname !== '/search'
        ? searchHistoryState(returnTo)
        : null;
    window.history.pushState(state, '', url);
    acceptedLocation.current = nextLocation;
    if (!preservesDocument) {
      pageRequestId.current++;
      setPage(null);
    }
    setLocation(currentLocation());
  }

  function retryPage(): void {
    positionedLocation.current = null;
    pageRequestId.current++;
    setHistoryScroll(null);
    setError('');
    setPage(null);
    setRequestRevision((value) => value + 1);
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
    pageRequestId.current++;
    setPage(null);
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
    setMobileNavigationOpen(false);
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
    if (
      !graphMode &&
      !confirmDiscardUnsavedChanges(
        documentDirty.current,
        window.confirm.bind(window),
      )
    ) {
      return;
    }
    if (!graphMode) documentDirty.current = false;
    setPersistedGraphMode(!graphMode);
  }

  function onDocumentModeChange(mode: DocumentMode): void {
    if (
      mode === 'view' &&
      !confirmDiscardUnsavedChanges(
        documentDirty.current,
        window.confirm.bind(window),
      )
    ) {
      return;
    }
    if (mode === 'view') documentDirty.current = false;
    setDocumentMode(mode);
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
    const anchor =
      target instanceof Element ? target.closest<HTMLAnchorElement>('a') : null;
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;

    const url = new URL(anchor.href, window.location.href);
    if (
      url.origin !== window.location.origin ||
      (!documentPath(url.pathname) &&
        !sourcePath(url.pathname) &&
        !externalTarget(url.pathname, url.hash))
    ) {
      return;
    }

    event.preventDefault();
    navigate(url);
  }

  if (graphActive) {
    const header = (
      _selectedNode: ViewGraphNode | null,
      _selectedTarget: string,
    ) => (
      <AppHeader
        className="graph-header"
        graphActive={graphActive}
        graphHref={currentLocation()}
        gitEnabled={gitEnabled}
        gitHasChanges={gitHasChanges}
        index={index}
        onGitToggle={() => setGitEnabled((enabled) => !enabled)}
        onGraphNavigate={onGraphToggleClick}
        onNavigate={onNavigationClick}
        onSearchNavigate={onSearchToggleClick}
        route={route}
        searchEnabled={!staticView}
      />
    );
    return (
      <div className="graph-shell">
        <GraphView
          generation={projectChange.generation}
          gitEnabled={gitEnabled}
          header={header}
          instanceId={projectChange.instanceId}
          markdownGeneration={projectChange.markdownGeneration}
          onNavigate={navigate}
          onShowSectionOutput={staticView ? undefined : setSectionOutputId}
          searchEnabled={!staticView}
          selectedNodeId={graphSelectedNodeId}
          target={graphSelectionTarget}
        />
        <SectionOutputDialog
          onClose={() => setSectionOutputId(null)}
          sectionId={sectionOutputId}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside
        className="sidebar"
        data-mobile-navigation-open={mobileNavigationOpen || undefined}
      >
        <AppHeader
          className="sidebar-header"
          graphActive={graphActive}
          graphHref={currentLocation()}
          gitEnabled={gitEnabled}
          gitHasChanges={gitHasChanges}
          index={index}
          onGitToggle={() => setGitEnabled((enabled) => !enabled)}
          onGraphNavigate={onGraphToggleClick}
          onNavigate={onNavigationClick}
          onSearchNavigate={onSearchToggleClick}
          route={route}
          searchEnabled={!staticView}
        />
        <MobileNavigationTrigger
          label={mobileNavigationLabel}
          onToggle={() => setMobileNavigationOpen((open) => !open)}
          open={mobileNavigationOpen}
        />
        <nav
          aria-label="Project files"
          id="mobile-file-navigation"
          tabIndex={-1}
        >
          {index && (
            <FileTree
              activePath={activePath}
              activeExternalTarget={activeExternalTarget}
              errorCounts={index.errorCounts}
              externalFiles={index.externalFiles}
              files={index.files}
              gitFiles={
                gitEnabled ? (index.git?.files ?? NO_GIT_FILES) : NO_GIT_FILES
              }
              onNavigate={onNavigationClick}
            />
          )}
          {!index && indexError && (
            <div className="sidebar-index-error" role="alert">
              <span>{indexError}</span>
              <button
                onClick={() => setConnectionRevision((value) => value + 1)}
                type="button"
              >
                Retry
              </button>
            </div>
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
            {route && route.kind !== 'search' && route.kind !== 'graph' && (
              <button className="state-retry" onClick={retryPage} type="button">
                Retry
              </button>
            )}
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
            {!editingDocument && (
              <DocumentToc
                gitEnabled={gitEnabled}
                items={page.document.tableOfContents}
                onNavigate={onNavigationClick}
              />
            )}
            <div className="document-column">
              <div className="document-header">
                <div className="document-header-line">
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
                  {!staticView && route?.kind === 'markdown' && (
                    <DocumentModeSwitch
                      mode={documentMode}
                      onChange={onDocumentModeChange}
                    />
                  )}
                </div>
                {errorsOpen && (
                  <DocumentErrorPanel
                    errors={page.document.errors}
                    onNavigate={onNavigationClick}
                  />
                )}
              </div>
              {editingDocument && route?.kind === 'markdown' && (
                <Suspense
                  fallback={
                    <div className="markdown-editor-state">Loading editor…</div>
                  }
                >
                  <MarkdownEditor
                    active
                    key={route.path}
                    onDirtyChange={(dirty) => {
                      documentDirty.current = dirty;
                    }}
                    path={route.path}
                    revision={projectChange.markdownGeneration}
                  />
                </Suspense>
              )}
              {!editingDocument && documentTree && (
                <MarkdownContent
                  backReferences={page.document.backReferences}
                  onClick={onDocumentClick}
                  onCopySectionLink={(headingId) =>
                    navigateAndCopySectionLink(
                      window.location.href,
                      headingId,
                      navigate,
                      window.navigator.clipboard,
                    )
                  }
                  onShowSectionOutput={setSectionOutputId}
                  sectionOutputEnabled={!staticView}
                  tree={documentTree}
                />
              )}
            </div>
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
      <SectionOutputDialog
        onClose={() => setSectionOutputId(null)}
        sectionId={sectionOutputId}
      />
    </div>
  );
}
