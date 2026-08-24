import { extname } from 'node:path';
import hljs from 'highlight.js/lib/core';
import c from 'highlight.js/lib/languages/c';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';

hljs.registerLanguage('c', c);
hljs.registerLanguage('go', go);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('typescript', typescript);

const languageByExtension: Record<string, string> = {
  '.c': 'c',
  '.go': 'go',
  '.h': 'c',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.ts': 'typescript',
  '.tsx': 'typescript',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const openSpans: string[] = [];
  const token = /<span class="[^"]+">|<\/span>|\n/g;
  let line = '';
  let cursor = 0;

  for (const match of html.matchAll(token)) {
    line += html.slice(cursor, match.index);
    const value = match[0];
    if (value === '\n') {
      line += '</span>'.repeat(openSpans.length);
      lines.push(line);
      line = openSpans.join('');
    } else if (value === '</span>') {
      openSpans.pop();
      line += value;
    } else {
      openSpans.push(value);
      line += value;
    }
    cursor = match.index + value.length;
  }
  line += html.slice(cursor);
  lines.push(line);
  return lines;
}

/** Highlight source into independently valid, escaped HTML lines. */
export function highlightSource(path: string, content: string): string[] {
  const language = languageByExtension[extname(path)];
  if (!language) return content.split(/\r?\n/).map(escapeHtml);
  const normalized = content.replaceAll('\r\n', '\n');
  const highlighted = hljs.highlight(normalized, {
    language,
    ignoreIllegals: true,
  }).value;
  return splitHighlightedLines(highlighted);
}
