import { basename } from 'node:path';
import type { RootContent } from 'mdast';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { WikiLink } from '../extensions/wiki-link/types.js';
import { parse } from '../parser.js';

const htmlProcessor = unified()
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeSlug)
  .use(rehypeStringify);

function nodeText(node: { value?: unknown; children?: unknown }): string {
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children
    .map((child) => nodeText(child as { value?: unknown; children?: unknown }))
    .join('');
}

/** Render a lat.md file as safe HTML while leaving wiki links as authored text. */
export async function renderMarkdown(
  markdown: string,
  filePath: string,
): Promise<{ html: string; title: string }> {
  const tree = parse(markdown);
  tree.children = tree.children.filter((node) => node.type !== 'yaml');

  const firstHeading = tree.children.find((node) => node.type === 'heading');
  const title = firstHeading
    ? nodeText(firstHeading)
    : basename(filePath, '.md');

  visit(tree, 'wikiLink', (node: WikiLink, index, parent) => {
    if (index === undefined || !parent || !('children' in parent)) return;
    const alias = node.data.alias ? `|${node.data.alias}` : '';
    parent.children[index] = {
      type: 'text',
      value: `[[${node.value}${alias}]]`,
    } as RootContent;
  });

  const hast = await htmlProcessor.run(tree);
  return { html: htmlProcessor.stringify(hast), title };
}
