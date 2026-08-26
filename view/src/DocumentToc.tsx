import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import type { ViewDocumentTocItem } from '../../src/view/protocol';
import {
  activeDocumentTocId,
  centeredDocumentTocScrollTop,
  documentTocActivationLine,
  documentTocIndentationDepth,
} from './document-toc';

type TocLinkStyle = CSSProperties & { '--toc-depth': number };

function TocIcon() {
  return (
    // Tabler Icons "list-tree" (MIT): https://tabler.io/icons
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9 6h11" />
      <path d="M12 12h8" />
      <path d="M15 18h5" />
      <path d="M5 6v.01" />
      <path d="M8 12v.01" />
      <path d="M11 18v.01" />
    </svg>
  );
}

export function DocumentToc({
  gitEnabled,
  items,
  onNavigate,
}: {
  gitEnabled: boolean;
  items: ViewDocumentTocItem[];
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const subsectionDepths = items
    .filter((item) => item.depth > 1)
    .map((item) => item.depth);
  const minimumSubsectionDepth =
    subsectionDepths.length > 0 ? Math.min(...subsectionDepths) : 2;
  const [activeId, setActiveId] = useState(ids[0] ?? '');
  const [expanded, setExpanded] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setExpanded(false);
  }, [ids]);

  useEffect(() => {
    if (!expanded) return;
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', closeForEscape);
    return () => window.removeEventListener('keydown', closeForEscape);
  }, [expanded]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const tops = new Map(
          ids.flatMap((id) => {
            const heading = window.document.getElementById(id);
            return heading ? [[id, heading.getBoundingClientRect().top]] : [];
          }),
        );
        const scrollingElement = window.document.scrollingElement;
        const threshold = documentTocActivationLine({
          scrollTop: scrollingElement?.scrollTop ?? window.scrollY,
          viewportHeight: scrollingElement?.clientHeight ?? window.innerHeight,
          scrollHeight:
            scrollingElement?.scrollHeight ??
            window.document.documentElement.scrollHeight,
        });
        setActiveId(activeDocumentTocId(ids, tops, threshold));
      });
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ids]);

  useEffect(() => {
    const navigation = navigationRef.current;
    const activeLink = navigation?.querySelector<HTMLElement>(
      '[aria-current="location"]',
    );
    if (!navigation || !activeLink || navigation.clientHeight === 0) return;

    const navigationRect = navigation.getBoundingClientRect();
    const activeRect = activeLink.getBoundingClientRect();
    const top = centeredDocumentTocScrollTop({
      containerHeight: navigation.clientHeight,
      contentHeight: navigation.scrollHeight,
      itemHeight: activeRect.height,
      itemTop: navigation.scrollTop + activeRect.top - navigationRect.top,
    });
    if (Math.abs(navigation.scrollTop - top) < 1) return;

    navigation.scrollTo({ behavior: 'smooth', top });
  }, [activeId, expanded]);

  if (items.length === 0) return null;

  return (
    <aside className="document-toc" data-expanded={expanded || undefined}>
      <div className="document-toc-title document-toc-heading">
        <TocIcon />
        <span>On this page</span>
      </div>
      <button
        aria-controls="document-table-of-contents"
        aria-expanded={expanded}
        className="document-toc-title document-toc-toggle"
        onClick={() => setExpanded((open) => !open)}
        type="button"
      >
        <TocIcon />
        <span>On this page</span>
        <span aria-hidden="true" className="document-toc-chevron">
          ›
        </span>
      </button>
      <nav
        aria-label="On this page"
        className="document-toc-list"
        id="document-table-of-contents"
        ref={navigationRef}
      >
        {items.map((item) => {
          const showGit = gitEnabled && item.hasGitChanges;
          return (
            <a
              aria-current={activeId === item.id ? 'location' : undefined}
              className="document-toc-link"
              data-depth={item.depth}
              href={`#${encodeURIComponent(item.id)}`}
              key={item.id}
              onClick={(event) => {
                setActiveId(item.id);
                setExpanded(false);
                onNavigate(event);
                if (item.depth === 1 && event.defaultPrevented) {
                  window.scrollTo({ top: 0, behavior: 'instant' });
                }
              }}
              style={
                {
                  '--toc-depth': documentTocIndentationDepth(
                    item.depth,
                    minimumSubsectionDepth,
                  ),
                } as TocLinkStyle
              }
            >
              <span className="document-toc-link-label">{item.title}</span>
              {(showGit || item.errorCount > 0) && (
                <span className="document-toc-states">
                  {showGit && (
                    <span
                      aria-label="Git changes"
                      className="document-toc-state git"
                      role="img"
                      title="Git changes"
                    />
                  )}
                  {item.errorCount > 0 && (
                    <span
                      aria-label={`${item.errorCount} validation ${item.errorCount === 1 ? 'error' : 'errors'}`}
                      className="document-toc-state error"
                      role="img"
                      title={`${item.errorCount} validation ${item.errorCount === 1 ? 'error' : 'errors'}`}
                    />
                  )}
                </span>
              )}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
