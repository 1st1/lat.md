import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type {
  ViewDocument,
  ViewError,
  ViewIndex,
} from '../../src/view/protocol';
import { FileTree } from './FileTree';
import {
  documentPath,
  documentUrl,
  scrollToDocumentLocation,
} from './navigation';

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
      scrollToDocumentLocation(window.location.hash, {
        getElementById: (id) => window.document.getElementById(id),
        scrollTo: (options) => window.scrollTo(options),
      });
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
          {index && (
            <FileTree
              activePath={path}
              files={index.files}
              onNavigate={onNavigationClick}
            />
          )}
        </nav>
      </aside>

      <main className="main">
        {document && (
          <div className="document-metadata">
            <div className="document-path">{document.path}</div>
            {document.frontmatter.requireCodeMention && (
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
