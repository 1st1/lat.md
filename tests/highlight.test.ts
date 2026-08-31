import { describe, expect, it } from 'vitest';
import { highlightCode, highlightSource } from '../src/view/highlight.js';
import type {
  ViewDocumentNode,
  ViewDocumentTree,
} from '../src/view/protocol.js';

function treeText(tree: ViewDocumentTree): string {
  const text = (node: ViewDocumentNode): string =>
    node.type === 'text' ? node.value : node.children.map(text).join('');
  return tree.children.map(text).join('');
}

function treeClasses(tree: ViewDocumentTree): string[] {
  const classes: string[] = [];
  const visit = (node: ViewDocumentNode): void => {
    if (node.type === 'text') return;
    const value = node.properties.className;
    if (Array.isArray(value)) classes.push(...value.map(String));
    else if (typeof value === 'string') classes.push(...value.split(/\s+/));
    for (const child of node.children) visit(child);
  };
  for (const node of tree.children) visit(node);
  return classes;
}

function treeTags(tree: ViewDocumentTree): string[] {
  const tags: string[] = [];
  const visit = (node: ViewDocumentNode): void => {
    if (node.type === 'text') return;
    tags.push(node.tagName);
    for (const child of node.children) visit(child);
  };
  for (const node of tree.children) visit(node);
  return tags;
}

describe('source highlighting', () => {
  // @lat: [[lat.md/view/specs#View Tests#Highlights source syntax safely]]
  it('emits safe structured lines and preserves multiline tokens', () => {
    const lines = highlightSource(
      'src/example.ts',
      "const value = '<script>alert(1)</script>';\n/* first\nsecond */",
    );

    expect(lines).toHaveLength(3);
    expect(treeClasses(lines[0])).toContain('hljs-keyword');
    expect(treeText(lines[0])).toContain('<script>alert(1)</script>');
    expect(treeTags(lines[0])).not.toContain('script');
    expect(treeClasses(lines[1])).toContain('hljs-comment');
    expect(treeClasses(lines[2])).toContain('hljs-comment');

    expect(highlightSource('notes.txt', '<safe>\n& literal')).toEqual([
      {
        version: 1,
        type: 'root',
        children: [{ type: 'text', value: '<safe>' }],
      },
      {
        version: 1,
        type: 'root',
        children: [{ type: 'text', value: '& literal' }],
      },
    ]);
    expect(highlightCode('unknown-language', '<safe>')).toBeNull();
  });
});
