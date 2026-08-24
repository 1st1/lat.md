import { basename } from 'node:path';
import type { RootContent } from 'mdast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { WikiLink } from '../extensions/wiki-link/types.js';
import { parse } from '../parser.js';

export type WikiLinkResolver = (
  target: string,
) => string | null | Promise<string | null>;

const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: (defaultSchema.attributes?.a ?? []).map((attribute) =>
      Array.isArray(attribute) && attribute[0] === 'className'
        ? [...attribute, 'wiki-link-segmented']
        : attribute,
    ),
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ['className', 'wiki-link-context', 'wiki-link-leaf'],
    ],
  },
};

const htmlProcessor = unified()
  .use(remarkRehype)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeSlug)
  .use(rehypeStringify);

function nodeText(node: { value?: unknown; children?: unknown }): string {
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children
    .map((child) => nodeText(child as { value?: unknown; children?: unknown }))
    .join('');
}

function wikiLinkContent(node: WikiLink): {
  children: RootContent[];
  segmented: boolean;
} {
  if (node.data.alias) {
    return {
      children: [{ type: 'text', value: node.data.alias } as RootContent],
      segmented: false,
    };
  }

  const hash = node.value.lastIndexOf('#');
  if (hash <= 0 || hash === node.value.length - 1) {
    return {
      children: [{ type: 'text', value: node.value } as RootContent],
      segmented: false,
    };
  }

  return {
    children: [
      {
        type: 'emphasis',
        data: {
          hName: 'span',
          hProperties: { className: ['wiki-link-context'] },
        },
        children: [{ type: 'text', value: node.value.slice(0, hash + 1) }],
      } as RootContent,
      {
        type: 'emphasis',
        data: {
          hName: 'span',
          hProperties: { className: ['wiki-link-leaf'] },
        },
        children: [{ type: 'text', value: node.value.slice(hash + 1) }],
      } as RootContent,
    ],
    segmented: true,
  };
}

/** Render a lat.md file as safe HTML with resolved wiki links. */
export async function renderMarkdown(
  markdown: string,
  filePath: string,
  resolveWikiLink?: WikiLinkResolver,
): Promise<{ html: string; title: string }> {
  const tree = parse(markdown);
  tree.children = tree.children.filter((node) => node.type !== 'yaml');

  const firstHeading = tree.children.find((node) => node.type === 'heading');
  const title = firstHeading
    ? nodeText(firstHeading)
    : basename(filePath, '.md');

  const resolvedLinks = new Map<WikiLink, string | null>();
  if (resolveWikiLink) {
    const wikiLinks: WikiLink[] = [];
    visit(tree, 'wikiLink', (node: WikiLink) => {
      wikiLinks.push(node);
    });
    for (const node of wikiLinks) {
      resolvedLinks.set(node, await resolveWikiLink(node.value));
    }
  }

  visit(tree, 'wikiLink', (node: WikiLink, index, parent) => {
    if (index === undefined || !parent || !('children' in parent)) return;
    const href = resolvedLinks.get(node);
    if (href) {
      const content = wikiLinkContent(node);
      parent.children[index] = {
        type: 'link',
        url: href,
        data: content.segmented
          ? { hProperties: { className: ['wiki-link-segmented'] } }
          : undefined,
        children: content.children,
      } as RootContent;
      return;
    }

    const alias = node.data.alias ? `|${node.data.alias}` : '';
    parent.children[index] = {
      type: 'text',
      value: `[[${node.value}${alias}]]`,
    } as RootContent;
  });

  const hast = await htmlProcessor.run(tree);
  return { html: htmlProcessor.stringify(hast), title };
}
