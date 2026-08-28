import { useEffect, useRef, type MouseEvent } from 'react';
import { renderMarkdownRichFences } from './markdown-rich-fences';

export function MarkdownContent({
  html,
  onClick,
}: {
  html: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const content = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    const cleanups: Array<() => void> = [];
    if (content.current) {
      void renderMarkdownRichFences(
        content.current,
        () => active,
        (cleanup) => {
          if (active) cleanups.push(cleanup);
          else cleanup();
        },
      );
    }
    return () => {
      active = false;
      for (const cleanup of cleanups) cleanup();
    };
  }, [html]);

  return (
    <article
      className="markdown"
      onClick={onClick}
      ref={content}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
