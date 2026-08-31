import { extname } from 'node:path';
import type { ElementContent } from 'hast';
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { textDocumentTree, toViewDocumentTree } from './document-tree.js';
import type { ViewDocumentTree } from './protocol.js';

const lowlight = createLowlight({
  bash,
  c,
  css,
  dart,
  diff,
  go,
  javascript,
  json,
  markdown,
  python,
  ruby,
  rust,
  typescript,
  xml,
  yaml,
});

const languageAliases: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  css: 'css',
  dart: 'dart',
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
  rb: 'ruby',
  ruby: 'ruby',
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
  '.dart': 'dart',
  '.go': 'go',
  '.h': 'c',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.ts': 'typescript',
  '.tsx': 'typescript',
};

export type HighlightedCodeTree = {
  type: 'root';
  children: ElementContent[];
};

/** Highlight a supported fenced-code language into a safe HAST fragment. */
export function highlightCode(
  language: string,
  content: string,
): HighlightedCodeTree | null {
  const registeredLanguage = languageAliases[language.toLowerCase()];
  if (!registeredLanguage) return null;
  const tree = lowlight.highlight(registeredLanguage, content);
  return {
    type: 'root',
    children: tree.children.filter(
      (node): node is ElementContent => node.type !== 'doctype',
    ),
  };
}

function splitHighlightedNode(node: ElementContent): ElementContent[][] {
  if (node.type !== 'element') {
    return node.value.split('\n').map((value) => [{ ...node, value }]);
  }
  return splitHighlightedNodes(node.children).map((children) => [
    { ...node, properties: { ...node.properties }, children },
  ]);
}

/** Split a HAST fragment at text newlines while cloning spanning elements. */
function splitHighlightedNodes(
  nodes: readonly ElementContent[],
): ElementContent[][] {
  const lines: ElementContent[][] = [[]];
  for (const node of nodes) {
    const fragments = splitHighlightedNode(node);
    lines[lines.length - 1].push(...fragments[0]);
    for (const fragment of fragments.slice(1)) lines.push(fragment);
  }
  return lines;
}

/** Highlight source directly into independently renderable document trees. */
export function highlightSource(
  path: string,
  content: string,
): ViewDocumentTree[] {
  const normalized = content.replaceAll('\r\n', '\n');
  const language = languageByExtension[extname(path)];
  if (!language) return normalized.split('\n').map(textDocumentTree);
  const highlighted = highlightCode(language, normalized);
  if (!highlighted) return normalized.split('\n').map(textDocumentTree);
  return splitHighlightedNodes(highlighted.children).map((children) =>
    toViewDocumentTree({ type: 'root', children }),
  );
}
