import { basename, extname } from 'node:path';
import type { Link, Root, RootContent } from 'mdast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { WikiLink } from '../extensions/wiki-link/types.js';
import { parse } from '../parser.js';

export type WikiLinkContext = { line: number };

export type WikiLinkResolver = (
  target: string,
  context: WikiLinkContext,
) => string | null | Promise<string | null>;

export type MarkdownRenderOptions = {
  activeMarkdownLink?: string;
  activeWikiLink?: string;
  lineOffset?: number;
  rewriteMarkdownLink?: (url: string) => string;
};

const CODE_LINK_CLASSES = [
  'wiki-link-code',
  'wiki-link-active',
  'code-link-language',
  'code-language-ts',
  'code-language-js',
  'code-language-py',
  'code-language-rs',
  'code-language-go',
  'code-language-c',
];

const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: (defaultSchema.attributes?.a ?? []).map((attribute) =>
      Array.isArray(attribute) && attribute[0] === 'className'
        ? [
            ...attribute,
            'wiki-link-segmented',
            'wiki-link-code',
            'wiki-link-active',
          ]
        : attribute,
    ),
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      'ariaHidden',
      [
        'className',
        'wiki-link-context',
        'wiki-link-leaf',
        ...CODE_LINK_CLASSES.slice(2),
      ],
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

function codeLanguage(target: string): {
  className: string;
  label: string;
} | null {
  switch (extname(target.split('#', 1)[0]).toLowerCase()) {
    case '.ts':
    case '.tsx':
      return { className: 'code-language-ts', label: 'TS' };
    case '.js':
    case '.jsx':
      return { className: 'code-language-js', label: 'JS' };
    case '.py':
      return { className: 'code-language-py', label: 'PY' };
    case '.rs':
      return { className: 'code-language-rs', label: 'RS' };
    case '.go':
      return { className: 'code-language-go', label: 'GO' };
    case '.c':
    case '.h':
      return { className: 'code-language-c', label: 'C' };
    default:
      return null;
  }
}

function languageIcon(language: {
  className: string;
  label: string;
}): RootContent {
  return {
    type: 'emphasis',
    data: {
      hName: 'span',
      hProperties: {
        ariaHidden: 'true',
        className: ['code-link-language', language.className],
      },
    },
    children: [{ type: 'text', value: language.label }],
  } as RootContent;
}

/** Render a lat.md file as safe HTML with resolved wiki links. */
export async function renderMarkdown(
  markdown: string,
  filePath: string,
  resolveWikiLink?: WikiLinkResolver,
  options: MarkdownRenderOptions = {},
  parsedTree?: Root,
): Promise<{ html: string; title: string }> {
  const tree = parsedTree ? structuredClone(parsedTree) : parse(markdown);
  tree.children = tree.children.filter((node) => node.type !== 'yaml');

  if (options.rewriteMarkdownLink || options.activeMarkdownLink) {
    visit(tree, 'link', (node: Link) => {
      const authoredUrl = node.url;
      if (
        options.activeMarkdownLink &&
        authoredUrl === options.activeMarkdownLink
      ) {
        node.data = {
          ...node.data,
          hProperties: {
            ...(node.data?.hProperties ?? {}),
            className: ['wiki-link-active'],
          },
        };
      }
      if (options.rewriteMarkdownLink) {
        node.url = options.rewriteMarkdownLink(authoredUrl);
      }
    });
  }

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
      resolvedLinks.set(
        node,
        await resolveWikiLink(node.value, {
          line: (node.position?.start.line ?? 0) + (options.lineOffset ?? 0),
        }),
      );
    }
  }

  visit(tree, 'wikiLink', (node: WikiLink, index, parent) => {
    if (index === undefined || !parent || !('children' in parent)) return;
    const href = resolvedLinks.get(node);
    if (href) {
      const content = wikiLinkContent(node);
      const language = href.startsWith('/code/')
        ? codeLanguage(node.value)
        : null;
      const classes = content.segmented ? ['wiki-link-segmented'] : [];
      if (language) classes.push('wiki-link-code');
      if (
        options.activeWikiLink &&
        node.value.toLowerCase() === options.activeWikiLink.toLowerCase()
      ) {
        classes.push('wiki-link-active');
      }
      parent.children[index] = {
        type: 'link',
        url: href,
        data:
          classes.length > 0
            ? { hProperties: { className: classes } }
            : undefined,
        children: language
          ? [languageIcon(language), ...content.children]
          : content.children,
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
