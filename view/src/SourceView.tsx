import type { ViewSourceDocument } from '../../src/view/protocol';

export const sourceLineId = (line: number) => `source-line-${line}`;

export function SourceView({ source }: { source: ViewSourceDocument }) {
  return (
    <>
      <div className="document-metadata">
        <div className="document-path">{source.path}</div>
        {source.focus && (
          <div className="document-flag">
            {source.focus.kind} {source.focus.symbol}
          </div>
        )}
      </div>
      {source.focus && (
        <div className="source-focus" title={source.focus.signature}>
          <span>Definition</span>
          <code>{source.focus.signature}</code>
        </div>
      )}
      <div
        className="source-code"
        aria-label={`Source code for ${source.path}`}
      >
        {source.highlightedHtmlLines.map((line, index) => {
          const lineNumber = index + 1;
          const focused = Boolean(
            source.focus &&
            lineNumber >= source.focus.startLine &&
            lineNumber <= source.focus.endLine,
          );
          return (
            <div
              className={focused ? 'source-line focused' : 'source-line'}
              id={sourceLineId(lineNumber)}
              key={lineNumber}
            >
              <span className="source-line-number" aria-hidden="true">
                {lineNumber}
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
