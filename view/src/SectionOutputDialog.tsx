import { useEffect, useRef, useState } from 'react';
import type { ViewSectionCommandOutput } from '../../src/view/protocol';
import { fetchViewJson } from './data-source';
import { MarkdownContent } from './MarkdownContent';
import { sectionOutputRequestUrl } from './section-back-references';

export type SectionOutputPresentation = 'raw' | 'formatted';
export const DEFAULT_SECTION_OUTPUT_PRESENTATION = 'formatted';

export function SectionOutputDialog({
  onClose,
  sectionId,
}: {
  onClose: () => void;
  sectionId: string | null;
}) {
  const [result, setResult] = useState<ViewSectionCommandOutput | null>(null);
  const [error, setError] = useState('');
  const [presentation, setPresentation] = useState<SectionOutputPresentation>(
    DEFAULT_SECTION_OUTPUT_PRESENTATION,
  );
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!sectionId) return;
    const controller = new AbortController();
    setResult(null);
    setError('');
    setPresentation(DEFAULT_SECTION_OUTPUT_PRESENTATION);
    void fetchViewJson<ViewSectionCommandOutput>(
      sectionOutputRequestUrl(sectionId),
      controller.signal,
    )
      .then(setResult)
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      });
    return () => controller.abort();
  }, [sectionId]);

  useEffect(() => {
    if (!sectionId) return;
    closeButton.current?.focus();
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeForEscape);
    return () => window.removeEventListener('keydown', closeForEscape);
  }, [onClose, sectionId]);

  if (!sectionId) return null;

  return (
    <div
      className="section-output-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="section-output-title"
        aria-modal="true"
        className="section-output-dialog"
        role="dialog"
      >
        <header className="section-output-header">
          <div className="section-output-heading">
            <div className="section-output-title-line">
              <h2 id="section-output-title">
                <code>lat section</code> output
              </h2>
              <div
                aria-label="Section output presentation"
                className="section-output-presentation"
                role="group"
              >
                {(['raw', 'formatted'] as const).map((value) => (
                  <button
                    aria-pressed={presentation === value}
                    key={value}
                    onClick={() => setPresentation(value)}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <code className="section-output-id">{sectionId}</code>
          </div>
          <button
            aria-label="Close section output"
            className="section-output-close"
            onClick={onClose}
            ref={closeButton}
            type="button"
          >
            ×
          </button>
        </header>
        {error ? (
          <div className="section-output-state error" role="alert">
            {error}
          </div>
        ) : result ? (
          presentation === 'formatted' ? (
            <div
              className="section-output-formatted"
              data-error={result.isError || undefined}
            >
              <MarkdownContent tree={result.tree} />
            </div>
          ) : (
            <pre
              className="section-output-raw"
              data-error={result.isError || undefined}
            >
              {result.output}
            </pre>
          )
        ) : (
          <div className="section-output-state">Running lat section…</div>
        )}
      </section>
    </div>
  );
}
