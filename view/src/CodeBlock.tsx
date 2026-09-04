import { useEffect, useState, type ReactNode } from 'react';

/** Keep clipboard controls outside the code and its horizontal scroll area. */
export function CodeBlock({
  children,
  text,
}: {
  children: ReactNode;
  text: string;
}) {
  const [result, setResult] = useState<{
    text: string;
    copied: boolean;
  } | null>(null);
  const currentResult = result?.text === text ? result : null;
  useEffect(() => {
    if (!result) return;
    const timeout = window.setTimeout(() => setResult(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [result]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setResult({ text, copied: true });
    } catch {
      setResult({ text, copied: false });
    }
  }

  const label = currentResult
    ? currentResult.copied
      ? 'Copied!'
      : 'Copy failed. Try again.'
    : 'Copy Code';
  return (
    <div className="code-block">
      {children}
      <button
        aria-label={label}
        className="code-block-copy"
        onClick={(event) => {
          event.stopPropagation();
          void copy();
        }}
        title={label}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          {currentResult?.copied ? (
            <path d="m3 8 3 3 7-7" />
          ) : (
            <>
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 3.5v-1h-8v8h1" />
            </>
          )}
        </svg>
        <span>
          {currentResult
            ? currentResult.copied
              ? 'Copied!'
              : 'Retry Copy'
            : 'Copy'}
        </span>
      </button>
      <span className="code-block-status" role="status">
        {currentResult ? label : ''}
      </span>
    </div>
  );
}
