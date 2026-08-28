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
    if (content.current) void renderMarkdownRichFences(content.current);
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
