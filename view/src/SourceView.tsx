import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type {
  ViewSourceDocument,
  ViewSourceReference,
} from '../../src/view/protocol';
import {
  captureScrollAnchor,
  restoreScrollAnchor,
  type ScrollAnchor,
} from './scroll-anchor';
import { getSourceWindowRows } from './source-window';

export const sourceLineId = (line: number) => `source-line-${line}`;

function Breadcrumbs({ reference }: { reference: ViewSourceReference }) {
  return (
    <span className="source-breadcrumbs">
      {reference.breadcrumbs.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 && <span aria-hidden="true">›</span>}
          {part}
        </span>
      ))}
    </span>
  );
}

function SourceContext({
  hasReferences,
  onContentClick,
  referencesOpen,
  setReferencesOpen,
  source,
}: {
  hasReferences: boolean;
  onContentClick: (event: MouseEvent<HTMLElement>) => void;
  referencesOpen: boolean;
  setReferencesOpen: (open: boolean) => void;
  source: ViewSourceDocument;
}) {
  return (
    <section
      className={[
        'source-context',
        hasReferences ? 'has-references' : '',
        referencesOpen ? 'references-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onContentClick}
    >
      <div className="source-context-header">
        <span>{source.context ? 'Context' : 'References'}</span>
      </div>
      {source.context && (
        <div className="source-context-current">
          <a href={source.context.url}>
            <Breadcrumbs reference={source.context} />
          </a>
          <div
            className="source-context-paragraph"
            dangerouslySetInnerHTML={{ __html: source.context.paragraphHtml }}
          />
        </div>
      )}
      {hasReferences && (
        <div className="source-reference-toggle">
          <button
            aria-controls="source-other-references"
            aria-expanded={referencesOpen}
            onClick={() => setReferencesOpen(!referencesOpen)}
            type="button"
          >
            {source.context ? 'Other references' : 'References'}
            <span>{source.otherReferences.length}</span>
          </button>
        </div>
      )}
      {referencesOpen && (
        <div className="source-reference-list" id="source-other-references">
          {source.otherReferences.map((reference) => (
            <div className="source-reference-item" key={reference.sectionId}>
              <a href={reference.url}>
                <Breadcrumbs reference={reference} />
              </a>
              <div
                className="source-reference-paragraph"
                dangerouslySetInnerHTML={{ __html: reference.paragraphHtml }}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ExpandLines({
  count,
  direction,
  onExpand,
}: {
  count: number;
  direction: 'above' | 'below';
  onExpand: () => void;
}) {
  return (
    <div className="source-collapse">
      <span aria-hidden="true">⋯</span>
      <button onClick={onExpand} type="button">
        Show {count} {count === 1 ? 'line' : 'lines'} {direction}
      </button>
    </div>
  );
}

export function SourceView({
  onContentClick,
  source,
}: {
  onContentClick: (event: MouseEvent<HTMLElement>) => void;
  source: ViewSourceDocument;
}) {
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [expandedAbove, setExpandedAbove] = useState(false);
  const [expandedBelow, setExpandedBelow] = useState(false);
  const pendingScrollAnchor = useRef<ScrollAnchor | null>(null);
  const hasReferences = source.otherReferences.length > 0;
  const hasContext = Boolean(source.context || hasReferences);
  const rows = getSourceWindowRows(
    source.highlightedHtmlLines.length,
    source.focus,
    hasContext,
    expandedAbove,
    expandedBelow,
  );

  useLayoutEffect(() => {
    const anchor = pendingScrollAnchor.current;
    if (!anchor) return;
    pendingScrollAnchor.current = null;
    restoreScrollAnchor(anchor, {
      getElementById: (id) => window.document.getElementById(id),
      scrollBy: (options) => window.scrollBy(options),
    });
  }, [expandedAbove]);

  function expandAbove(): void {
    const firstLine = rows.find((row) => row.kind === 'line');
    if (firstLine) {
      pendingScrollAnchor.current = captureScrollAnchor(
        sourceLineId(firstLine.lineNumber),
        {
          getElementById: (id) => window.document.getElementById(id),
        },
      );
    }
    setExpandedAbove(true);
  }

  return (
    <>
      <div className="document-metadata">
        <div className="document-path">{source.path}</div>
        {source.focus && (
          <div className="document-flag" title={source.focus.signature}>
            {source.focus.kind} {source.focus.symbol}
          </div>
        )}
      </div>
      <div
        className="source-code"
        aria-label={`Source code for ${source.path}`}
      >
        {rows.map((row) => {
          if (row.kind === 'context') {
            return (
              <SourceContext
                hasReferences={hasReferences}
                key="context"
                onContentClick={onContentClick}
                referencesOpen={referencesOpen}
                setReferencesOpen={setReferencesOpen}
                source={source}
              />
            );
          }
          if (row.kind === 'expand') {
            return (
              <ExpandLines
                count={row.count}
                direction={row.direction}
                key={`expand-${row.direction}`}
                onExpand={() =>
                  row.direction === 'above'
                    ? expandAbove()
                    : setExpandedBelow(true)
                }
              />
            );
          }

          const line = source.highlightedHtmlLines[row.lineNumber - 1];
          return (
            <div
              className={row.focused ? 'source-line focused' : 'source-line'}
              id={sourceLineId(row.lineNumber)}
              key={row.lineNumber}
            >
              <span className="source-line-number" aria-hidden="true">
                {row.lineNumber}
              </span>
              <code
                className="source-line-content"
                dangerouslySetInnerHTML={{ __html: line || ' ' }}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
