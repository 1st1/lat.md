import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type {
  ViewDocument,
  ViewError,
  ViewIndex,
} from '../../src/view/protocol';
import { documentPath, documentUrl } from './navigation';

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

function linkLabel(path: string): string {
  return path.replace(/\.md$/i, '').replaceAll('/', ' / ');
}

export function App() {
  const [location, setLocation] = useState(currentLocation);
  const [index, setIndex] = useState<ViewIndex | null>(null);
  const [document, setDocument] = useState<ViewDocument | null>(null);
  const [error, setError] = useState('');
  const path = useMemo(
    () => documentPath(window.location.pathname),
    [location],
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
    if (!path) {
      setError('This is not a Markdown document URL.');
      return;
    }

    const controller = new AbortController();
    setError('');
    setDocument(null);
    fetchJson<ViewDocument>(
      `/api/document?path=${encodeURIComponent(path)}`,
      controller.signal,
    )
      .then(setDocument)
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      });
    return () => controller.abort();
  }, [path]);

  useEffect(() => {
    if (!document) return;
    window.document.title = `${document.title} · lat.md`;
    requestAnimationFrame(() => {
      if (window.location.hash) {
        let id = window.location.hash.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // Leave malformed fragments untouched; they simply will not match.
        }
        window.document.getElementById(id)?.scrollIntoView();
      } else {
        window.scrollTo({ top: 0 });
      }
    });
  }, [document, location]);

  function navigate(url: URL): void {
    window.history.pushState(null, '', url);
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
    const anchor =
      target instanceof Element ? target.closest<HTMLAnchorElement>('a') : null;
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;

    const url = new URL(anchor.href, window.location.href);
    const nextPath = documentPath(url.pathname);
    if (
      url.origin !== window.location.origin ||
      !nextPath?.toLowerCase().endsWith('.md')
    ) {
      return;
    }

    event.preventDefault();
    navigate(url);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href={index ? documentUrl(index.entry) : '/'}
          onClick={index ? onNavigationClick : undefined}
        >
          lat<span>.md</span>
        </a>
        <div className="sidebar-label">Documents</div>
        <nav aria-label="Markdown files">
          {index?.files.map((file) => (
            <a
              className={
                file === path ? 'document-link active' : 'document-link'
              }
              href={documentUrl(file)}
              key={file}
              onClick={onNavigationClick}
            >
              {linkLabel(file)}
            </a>
          ))}
        </nav>
      </aside>

      <main className="main">
        {document && <div className="document-path">{document.path}</div>}
        {error ? (
          <div className="state error" role="alert">
            <strong>Could not open this document</strong>
            <span>{error}</span>
          </div>
        ) : document ? (
          <article
            className="markdown"
            onClick={onDocumentClick}
            dangerouslySetInnerHTML={{ __html: document.html }}
          />
        ) : (
          <div className="state">Loading…</div>
        )}
      </main>
    </div>
  );
}
