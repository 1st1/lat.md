import {
  useEffect,
  useLayoutEffect,
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
  documentTocActiveGroup,
  nextDocumentTocScrollTop,
} from './document-toc';

type TocLinkStyle = CSSProperties & { '--toc-depth': number };
type TocIndicator = {
  depth: number;
  top: number;
  height: number;
  visible: boolean;
};

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
  const { groupIds, ancestorIds } = useMemo(
    () => documentTocActiveGroup(items, activeId),
    [items, activeId],
  );
  const [expanded, setExpanded] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const scrollAnimation = useRef({ frame: 0, target: 0, position: 0, time: 0 });

  useEffect(() => {
    const navigation = navigationRef.current;
    const animation = scrollAnimation.current;
    const stop = () => {
      window.cancelAnimationFrame(animation.frame);
      animation.frame = 0;
    };
    navigation?.addEventListener('wheel', stop, { passive: true });
    navigation?.addEventListener('touchstart', stop, { passive: true });
    navigation?.addEventListener('pointerdown', stop);
    navigation?.addEventListener('keydown', stop);
    return () => {
      stop();
      navigation?.removeEventListener('wheel', stop);
      navigation?.removeEventListener('touchstart', stop);
      navigation?.removeEventListener('pointerdown', stop);
      navigation?.removeEventListener('keydown', stop);
    };
  }, []);
  const [indicators, setIndicators] = useState<TocIndicator[]>([]);
  const indicatorIds = useRef(ids);

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const links = [
      ...navigation.querySelectorAll<HTMLElement>('.document-toc-link'),
    ];
    const measure = () => {
      if (!navigation.clientHeight) return;
      const next = links.flatMap((link, index): TocIndicator[] => {
        if (
          !link.hasAttribute('aria-current') &&
          !link.hasAttribute('data-active-ancestor')
        )
          return [];
        const insetTop = index === 0 ? 0 : 4;
        const insetBottom = index === links.length - 1 ? 0 : 4;
        return [
          {
            depth: Number(link.style.getPropertyValue('--toc-depth')),
            top: link.offsetTop + insetTop,
            height: Math.max(0, link.offsetHeight - insetTop - insetBottom),
            visible: true,
          },
        ];
      });
      const sameDocument = indicatorIds.current === ids;
      indicatorIds.current = ids;
      setIndicators((previous) => [
        ...next,
        ...(sameDocument
          ? previous
              .filter((bar) => !next.some((item) => item.depth === bar.depth))
              .map((bar) => ({ ...bar, visible: false }))
          : []),
      ]);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(navigation);
    links.forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [activeId, ancestorIds, ids, expanded]);

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
    const animation = scrollAnimation.current;
    animation.target = top;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) {
      window.cancelAnimationFrame(animation.frame);
      animation.frame = 0;
      navigation.scrollTo({ behavior: 'instant', top });
      return;
    }
    if (animation.frame || Math.abs(navigation.scrollTop - top) < 1) return;

    animation.position = navigation.scrollTop;
    animation.time = performance.now();
    const tick = (time: number) => {
      animation.frame = 0;
      if (!navigation.clientHeight) return;
      animation.target = Math.max(
        0,
        Math.min(
          animation.target,
          navigation.scrollHeight - navigation.clientHeight,
        ),
      );
      animation.position = reducedMotion.matches
        ? animation.target
        : nextDocumentTocScrollTop(
            animation.position,
            animation.target,
            time - animation.time,
          );
      animation.time = time;
      navigation.scrollTo({ behavior: 'instant', top: animation.position });
      if (animation.position !== animation.target) {
        animation.frame = window.requestAnimationFrame(tick);
      }
    };
    animation.frame = window.requestAnimationFrame(tick);
  }, [activeId, expanded]);

  if (items.length === 0) return null;

  return (
    <aside className="document-toc" data-expanded={expanded || undefined}>
      <div className="document-toc-title document-toc-heading">
        <TocIcon />
        <span>On This Page</span>
      </div>
      <button
        aria-controls="document-table-of-contents"
        aria-expanded={expanded}
        className="document-toc-title document-toc-toggle"
        onClick={() => setExpanded((open) => !open)}
        type="button"
      >
        <TocIcon />
        <span>On This Page</span>
        <span aria-hidden="true" className="document-toc-chevron">
          ›
        </span>
      </button>
      <nav
        aria-label="On This Page"
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
              data-active-group={groupIds.has(item.id) || undefined}
              data-active-ancestor={ancestorIds.has(item.id) || undefined}
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
        {indicators.map((bar) => (
          <span
            aria-hidden="true"
            className="document-toc-indicator"
            key={bar.depth}
            style={
              {
                '--toc-depth': bar.depth,
                transform: `translateY(${bar.top}px)`,
                height: bar.height,
                opacity: bar.visible ? 1 : 0,
              } as TocLinkStyle
            }
          />
        ))}
      </nav>
    </aside>
  );
}
