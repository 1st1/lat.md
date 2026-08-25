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

export type WikiLinkResolution = {
  href: string;
  referenceCount: number;
};

export type WikiLinkResolver = (
  target: string,
  context: WikiLinkContext,
) => WikiLinkResolution | null | Promise<WikiLinkResolution | null>;

export type MarkdownRenderOptions = {
  activeMarkdownLink?: string;
  activeWikiLink?: string;
  errors?: {
    anchor: string;
    line: number;
    marker: 'heading' | 'line' | 'target';
    target: string;
  }[];
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

const ERROR_CLASS = 'markdown-error';
const GIT_CLASSES = ['git-added', 'git-removed'];

function classAttributes(
  tag: string,
): NonNullable<SanitizeSchema['attributes']>[string] {
  return [
    ...(defaultSchema.attributes?.[tag] ?? []),
    ['className', ERROR_CLASS, ...GIT_CLASSES],
  ];
}

const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'ins'],
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter(
        (attribute) =>
          !(Array.isArray(attribute) && attribute[0] === 'className'),
      ),
      [
        'className',
        'data-footnote-backref',
        'wiki-link-segmented',
        'wiki-link-code',
        'wiki-link-active',
        ERROR_CLASS,
        ...GIT_CLASSES,
      ],
    ],
    blockquote: classAttributes('blockquote'),
    code: classAttributes('code'),
    del: classAttributes('del'),
    div: classAttributes('div'),
    h1: classAttributes('h1'),
    h2: classAttributes('h2'),
    h3: classAttributes('h3'),
    h4: classAttributes('h4'),
    h5: classAttributes('h5'),
    h6: classAttributes('h6'),
    img: classAttributes('img'),
    ins: classAttributes('ins'),
    li: classAttributes('li'),
    p: classAttributes('p'),
    pre: classAttributes('pre'),
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      'ariaHidden',
      'ariaLabel',
      [
        'className',
        'wiki-link-context',
        'wiki-link-leaf',
        'wiki-link-ref-count',
        ...CODE_LINK_CLASSES.slice(2),
        ERROR_CLASS,
        ...GIT_CLASSES,
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

function referenceCountBadge(count: number): RootContent {
  return {
    type: 'emphasis',
    data: {
      hName: 'span',
      hProperties: {
        className: ['wiki-link-ref-count'],
        ariaLabel: `${count} ${count === 1 ? 'reference' : 'references'}`,
      },
    },
    children: [{ type: 'text', value: String(count) }],
  } as RootContent;
}

type MarkableNode = RootContent & {
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

function targetMatches(node: MarkableNode, target: string): boolean {
  if (node.type === 'wikiLink') {
    return (node as WikiLink).value.toLowerCase() === target.toLowerCase();
  }
  if (node.type === 'link' || node.type === 'image') {
    return node.url === target;
  }
  if (node.type === 'linkReference' || node.type === 'imageReference') {
    return node.identifier.toLowerCase() === target.toLowerCase();
  }
  return false;
}

function errorNodeScore(
  node: MarkableNode,
  error: NonNullable<MarkdownRenderOptions['errors']>[number],
): number | null {
  const { line, marker, target } = error;
  const start = node.position?.start.line;
  const end = node.position?.end.line;
  if (!start || !end || line < start || line > end) return null;
  if (marker === 'heading') {
    return start === line && node.type === 'heading' ? 0 : null;
  }
  if (marker === 'target' && targetMatches(node, target)) return 0;
  if (node.type === 'paragraph') return marker === 'line' ? 1 : 3;
  if (start === line) return 4;
  return 5 + (end - start);
}

function markMarkdownErrors(
  tree: Root,
  errors: NonNullable<MarkdownRenderOptions['errors']>,
): void {
  for (const error of errors) {
    let selected: MarkableNode | null = null;
    let selectedScore = Number.POSITIVE_INFINITY;
    visit(tree, (candidate) => {
      if (candidate.type === 'root' || candidate.type === 'text') return;
      const node = candidate as MarkableNode;
      const score = errorNodeScore(node, error);
      if (score === null || score >= selectedScore) return;
      selected = node;
      selectedScore = score;
    });
    if (!selected) continue;

    const node = selected as MarkableNode;
    const properties = node.data?.hProperties ?? {};
    const currentClasses = properties.className;
    const classes = Array.isArray(currentClasses)
      ? currentClasses.map(String)
      : currentClasses
        ? [String(currentClasses)]
        : [];
    if (!classes.includes(ERROR_CLASS)) classes.push(ERROR_CLASS);
    const generatedAnchor = error.anchor.startsWith('user-content-');
    node.data = {
      ...node.data,
      hProperties: {
        ...properties,
        className: classes,
        ...(node.type === 'heading' && !generatedAnchor
          ? {}
          : { id: error.anchor.replace(/^user-content-/, '') }),
      },
    };
  }
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
  if (options.errors) markMarkdownErrors(tree, options.errors);

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

  const resolvedLinks = new Map<WikiLink, WikiLinkResolution | null>();
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
    const resolution = resolvedLinks.get(node);
    const markedProperties = node.data?.hProperties as
      | Record<string, unknown>
      | undefined;
    if (resolution) {
      const { href, referenceCount } = resolution;
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
          classes.length > 0 || markedProperties
            ? {
                hProperties: {
                  ...markedProperties,
                  className: [
                    ...classes,
                    ...(Array.isArray(markedProperties?.className)
                      ? markedProperties.className.map(String)
                      : []),
                  ],
                },
              }
            : undefined,
        children: [
          ...(language ? [languageIcon(language)] : []),
          ...content.children,
          ...(referenceCount > 0 ? [referenceCountBadge(referenceCount)] : []),
        ],
      } as RootContent;
      return;
    }

    const alias = node.data.alias ? `|${node.data.alias}` : '';
    parent.children[index] = markedProperties
      ? ({
          type: 'emphasis',
          data: {
            hName: 'span',
            hProperties: markedProperties,
          },
          children: [{ type: 'text', value: `[[${node.value}${alias}]]` }],
        } as RootContent)
      : ({
          type: 'text',
          value: `[[${node.value}${alias}]]`,
        } as RootContent);
  });

  const hast = await htmlProcessor.run(tree);
  return { html: htmlProcessor.stringify(hast), title };
}
