import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import type { Nodes } from 'mdast';
import { wikiLinkSyntax } from '../../src/extensions/wiki-link/syntax';
import { wikiLinkFromMarkdown } from '../../src/extensions/wiki-link/from-markdown';
import type { ViewSearchResult } from '../../src/view/protocol';
import { searchResultUrl } from './search-highlights';

/** Preview only: render Markdown structure without executing HTML or loading assets. */
function previewNode(node: Nodes, key: number): ReactNode {
  const children = 'children' in node ? node.children.map(previewNode) : null;
  switch (node.type) {
    case 'root':
      return children;
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'heading':
      return (
        <p key={key}>
          <strong>{children}</strong>
        </p>
      );
    case 'text':
      return node.value;
    case 'inlineCode':
      return <code key={key}>{node.value}</code>;
    case 'wikiLink':
      return (
        <code key={key} title={node.value}>
          {node.data.alias ?? node.value}
        </code>
      );
    case 'code':
      return (
        <pre key={key}>
          <code>{node.value}</code>
        </pre>
      );
    case 'strong':
      return <strong key={key}>{children}</strong>;
    case 'emphasis':
      return <em key={key}>{children}</em>;
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>;
    case 'list':
      return node.ordered ? (
        <ol key={key} start={node.start ?? 1}>
          {children}
        </ol>
      ) : (
        <ul key={key}>{children}</ul>
      );
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'break':
      return <br key={key} />;
    case 'thematicBreak':
      return <hr key={key} />;
    case 'table':
      return (
        <div className="search-preview-table" key={key}>
          <table>
            <thead>
              <tr>
                {node.children[0]?.children.map((cell, i) => (
                  <th key={i}>{cell.children.map(previewNode)}</th>
                ))}
              </tr>
            </thead>
            <tbody>{node.children.slice(1).map(previewNode)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{children}</tr>;
    case 'tableCell':
      return <td key={key}>{children}</td>;
    case 'image':
    case 'imageReference':
      return node.alt;
    case 'html':
      return node.value;
    case 'definition':
      return null;
    default:
      return children;
  }
}

export function SearchResultCard({
  result,
  rank,
  onNavigate,
}: {
  result: ViewSearchResult;
  rank: number;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const passage = result.evidence[0];
  const text = passage?.text ?? result.description;
  const preview = useMemo(
    () =>
      previewNode(
        fromMarkdown(text, {
          extensions: [gfmTable(), wikiLinkSyntax()],
          mdastExtensions: [gfmTableFromMarkdown(), wikiLinkFromMarkdown()],
        }),
        0,
      ),
    [text],
  );
  const expandable = text.length > 360 || text.split('\n').length > 6;
  const spans = passage?.spans ?? [];
  const lines = spans
    .map((span) =>
      span.startLine === span.endLine
        ? `${span.startLine}`
        : `${span.startLine}–${span.endLine}`,
    )
    .join(', ');
  const hasLexical = result.lexicalRank !== undefined;
  const hasSemantic = result.semanticRank !== undefined;
  const match =
    hasLexical && hasSemantic
      ? 'Text + semantic'
      : hasLexical
        ? 'Text match'
        : hasSemantic
          ? 'Semantic match'
          : null;
  return (
    <article className="search-result">
      <div className="search-result-heading">
        <a
          className="search-result-link"
          href={searchResultUrl(result.url, spans)}
          onClick={onNavigate}
        >
          <span className="search-result-breadcrumbs">
            {result.breadcrumbs.slice(0, -1).join(' › ')}
          </span>
          <h2>
            <span className="search-result-rank">{rank}.</span> {result.title}
          </h2>
        </a>
        <details className="search-result-score">
          <summary
            aria-label={`Hybrid score ${result.rankScore.toFixed(6)}; show score details`}
          >
            <span>Hybrid score</span>
            <strong>{result.rankScore.toFixed(6)}</strong>
          </summary>
          <div className="search-score-details">
            <p>
              Combines text and semantic ranks. Higher is better within this
              search; this is not a confidence percentage.
            </p>
            <dl>
              <div>
                <dt>Text rank</dt>
                <dd>{result.lexicalRank ?? 'No match'}</dd>
              </div>
              <div>
                <dt>Semantic rank</dt>
                <dd>{result.semanticRank ?? 'No match'}</dd>
              </div>
              {result.semanticSimilarity !== undefined && (
                <div>
                  <dt>Cosine similarity</dt>
                  <dd>{result.semanticSimilarity.toFixed(3)}</dd>
                </div>
              )}
            </dl>
          </div>
        </details>
      </div>
      <div className="search-result-meta">
        {match && <span>{match}</span>}
        {lines && <span>Matched lines {lines}</span>}
      </div>
      <div
        className={`search-passage${expandable && !expanded ? ' search-passage-collapsed' : ''}`}
      >
        {preview}
      </div>
      {expandable && (
        <button
          className="search-passage-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show full passage'}
        </button>
      )}
    </article>
  );
}
