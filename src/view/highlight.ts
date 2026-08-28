import { extname } from 'node:path';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const languageAliases: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  css: 'css',
  diff: 'diff',
  go: 'go',
  h: 'c',
  html: 'xml',
  js: 'javascript',
  javascript: 'javascript',
  json: 'json',
  jsx: 'javascript',
  markdown: 'markdown',
  md: 'markdown',
  py: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  sh: 'bash',
  shell: 'bash',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

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

/** Highlight a supported fenced-code language into escaped HTML. */
export function highlightCode(
  language: string,
  content: string,
): string | null {
  const registeredLanguage = languageAliases[language.toLowerCase()];
  if (!registeredLanguage) return null;
  return hljs.highlight(content, {
    language: registeredLanguage,
    ignoreIllegals: true,
  }).value;
}

/** Highlight source into independently valid, escaped HTML lines. */
export function highlightSource(path: string, content: string): string[] {
  const language = languageByExtension[extname(path)];
  if (!language) return content.split(/\r?\n/).map(escapeHtml);
  const normalized = content.replaceAll('\r\n', '\n');
  const highlighted = highlightCode(language, normalized);
  if (highlighted === null) return normalized.split('\n').map(escapeHtml);
  return splitHighlightedLines(highlighted);
}
