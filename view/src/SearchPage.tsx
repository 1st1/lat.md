import { SearchResultCard } from './SearchResultCard';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import type {
  ViewSearchResponse,
  ViewSearchResult,
} from '../../src/view/protocol';
import { fetchViewJson } from './data-source';
import {
  searchEscapeAction,
  searchQuery,
  searchUrl,
  type ViewScrollPosition,
} from './navigation';

const SEARCH_DEBOUNCE_MS = 250;

export function SearchPage({
  onClose,
  onNavigate,
  onScrollRestored,
  markdownGeneration,
  restoreScroll,
}: {
  onClose: () => void;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  onScrollRestored: () => void;
  markdownGeneration: number;
  restoreScroll: ViewScrollPosition | null;
}) {
  const [query, setQuery] = useState(() => searchQuery(window.location.search));
  const [results, setResults] = useState<ViewSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!restoreScroll) return;
    if (query.trim() && !searched && !error) return;
    window.scrollTo({ ...restoreScroll, behavior: 'instant' });
    onScrollRestored();
  }, [error, onScrollRestored, query, restoreScroll, searched]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (searchEscapeAction(query) === 'clear') {
        setQuery('');
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, query]);

  useEffect(() => {
    const url = searchUrl(query);
    const current = `${window.location.pathname}${window.location.search}`;
    if (url !== current) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, [query]);

  useEffect(() => {
    const normalized = query.trim();
    const controller = new AbortController();
    setError('');
    setSearched(false);
    setLoading(false);
    setResults([]);
    if (!normalized) return () => controller.abort();

    const timeout = window.setTimeout(() => {
      setLoading(true);
      void fetchViewJson<ViewSearchResponse>(
        `/api/search?query=${encodeURIComponent(normalized)}`,
        controller.signal,
      )
        .then((response) => {
          setResults(response.results);
          setSearched(true);
        })
        .catch((reason: Error) => {
          if (!controller.signal.aborted) setError(reason.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [markdownGeneration, query]);

  return (
    <section className="search-page">
      <label className="search-input-shell">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <span className="visually-hidden">Search lat.md sections</span>
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search lat.md…"
          ref={input}
          spellCheck="false"
          type="search"
          value={query}
        />
      </label>

      <div aria-live="polite" className="search-status">
        {loading && 'Searching sections…'}
        {!loading &&
          !error &&
          searched &&
          results.length > 0 &&
          `Showing ${results.length} matching sections, ranked by relevance`}
        {!loading && error}
        {!loading &&
          !error &&
          searched &&
          results.length === 0 &&
          'No matching sections.'}
      </div>

      {results.length > 0 && (
        <div className="search-results">
          {results.map((result, index) => (
            <SearchResultCard
              key={result.sectionId}
              result={result}
              rank={index + 1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </section>
  );
}
