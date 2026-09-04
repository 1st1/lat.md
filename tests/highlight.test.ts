import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { toViewDocumentTree } from '../src/view/document-tree.js';
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
  // @lat: [[lat.md/view/specs#View Tests#Uses Geist syntax colors]]
  it('shares Geist light and dark syntax roles across code and source views', () => {
    const styles = readFileSync(
      new URL('../view/src/styles.css', import.meta.url),
      'utf8',
    );
    const palette = {
      comment: ['oklch(0.42 0 0)', 'oklch(0.706 0 0)'],
      keyword: ['oklch(53.5% 0.2058 2.84)', 'oklch(69.36% 0.2223 3.91)'],
      number: ['oklch(53.18% 0.2399 256.99)', 'oklch(71.7% 0.1648 250.79)'],
      string: ['oklch(51.75% 0.1453 147.65)', 'oklch(73.1% 0.2158 148.29)'],
      title: ['oklch(47.18% 0.2579 304)', 'oklch(69.87% 0.2037 309.51)'],
      markup: ['oklch(52.79% 0.1496 54.65)', 'oklch(77.21% 0.1991 64.28)'],
    };
    for (const [role, colors] of Object.entries(palette)) {
      const declarations = Array.from(
        styles.matchAll(new RegExp(`--syntax-${role}: ([^;]+);`, 'g')),
        (match) => match[1],
      );
      expect(declarations).toEqual(colors);
    }
    const rules = new Map(
      Array.from(
        styles
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .matchAll(/([^{}]+)\{([^{}]*)\}/g),
      ).flatMap(([, selectors, declarations]) =>
        selectors.split(',').map((selector) => [selector.trim(), declarations]),
      ),
    );
    const roles = {
      comment: 'syntax-comment',
      keyword: 'syntax-keyword',
      literal: 'syntax-number',
      number: 'syntax-number',
      string: 'syntax-string',
      title: 'syntax-title',
      built_in: 'syntax-title',
      params: 'text',
      attr: 'text',
      attribute: 'text',
      punctuation: 'text',
      subst: 'text',
    };
    for (const scope of ['markdown', 'source-code']) {
      for (const [token, role] of Object.entries(roles)) {
        expect(rules.get(`.${scope} .hljs-${token}`)).toContain(
          `color: var(--${role});`,
        );
      }
    }
    expect(rules.get('.markdown .language-json .hljs-keyword')).toContain(
      'color: var(--syntax-number);',
    );
  });

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

    const dart = highlightSource(
      'lib/example.dart',
      "class Greeter { String greet() => 'hello'; }",
    );
    expect(treeClasses(dart[0])).toContain('hljs-class');
    expect(treeText(dart[0])).toContain('Greeter');

    const java = highlightSource(
      'src/Greeter.java',
      'class Greeter { String greet() { return "hello"; } }',
    );
    expect(treeClasses(java[0])).toContain('hljs-title');
    expect(treeText(java[0])).toContain('Greeter');

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

    const ruby = highlightCode('ruby', 'puts "hello"');
    expect(ruby).not.toBeNull();
    expect(treeClasses(toViewDocumentTree(ruby!))).toContain('hljs-string');
  });
});
