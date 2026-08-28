import { basename, extname } from 'node:path';
import type {
  Blockquote,
  Code,
  Link,
  PhrasingContent,
  Root,
  RootContent,
} from 'mdast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkEmoji from 'remark-emoji';
import remarkRehype from 'remark-rehype';
import type { Options as RemarkRehypeOptions } from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { AlertMarker } from '../extensions/alert-marker.js';
import type { WikiLink } from '../extensions/wiki-link/types.js';
import { parse } from '../parser.js';
import { highlightCode } from './highlight.js';

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
  'code-link-leading',
  'code-language-ts',
  'code-language-js',
  'code-language-py',
  'code-language-rs',
  'code-language-go',
  'code-language-c',
];

const ERROR_CLASS = 'markdown-error';
const EXTERNAL_LINK_CLASS = 'external-link';
const EXTERNAL_LINK_ICON_CLASS = 'external-link-icon';
const GIT_CLASSES = ['git-added', 'git-removed'];
const GEOJSON_SOURCE_CLASS = 'markdown-geojson-source';
const HIGHLIGHT_CLASS = 'hljs';
const MERMAID_SOURCE_CLASS = 'markdown-mermaid-source';
const RICH_FENCE_SOURCE_CLASS = 'markdown-diagram-source';
const STL_SOURCE_CLASS = 'markdown-stl-source';
const TOPOJSON_SOURCE_CLASS = 'markdown-topojson-source';
const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
const ALERT_CLASSES = [
  'markdown-alert',
  'markdown-alert-title',
  ...ALERT_KINDS.map((kind) => `markdown-alert-${kind}`),
];
const GITHUB_CUSTOM_EMOJI = new Set([
  'atom',
  'basecamp',
  'basecampy',
  'bowtie',
  'electron',
  'feelsgood',
  'finnadie',
  'fishsticks',
  'fu',
  'goberserk',
  'godmode',
  'hurtrealbad',
  'neckbeard',
  'octocat',
  'rage1',
  'rage2',
  'rage3',
  'rage4',
  'shipit',
  'suspect',
  'trollface',
]);

function classAttributes(
  tag: string,
  extraClasses: string[] = [],
): NonNullable<SanitizeSchema['attributes']>[string] {
  const attributes = defaultSchema.attributes?.[tag] ?? [];
  const allowedClasses = attributes.flatMap((attribute) =>
    Array.isArray(attribute) && attribute[0] === 'className'
      ? attribute.slice(1)
      : [],
  );
  return [
    ...attributes.filter(
      (attribute) =>
        !(Array.isArray(attribute) && attribute[0] === 'className'),
    ),
    [
      'className',
      ...allowedClasses,
      ERROR_CLASS,
      ...GIT_CLASSES,
      ...extraClasses,
    ],
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
        EXTERNAL_LINK_CLASS,
        ERROR_CLASS,
        ...GIT_CLASSES,
      ],
    ],
    blockquote: classAttributes('blockquote'),
    code: classAttributes('code', [
      HIGHLIGHT_CLASS,
      'math-display',
      'math-inline',
    ]),
    del: classAttributes('del'),
    details: [...(defaultSchema.attributes?.details ?? []), ['open', true]],
    div: classAttributes('div', ALERT_CLASSES),
    h1: classAttributes('h1'),
    h2: classAttributes('h2'),
    h3: classAttributes('h3'),
    h4: classAttributes('h4'),
    h5: classAttributes('h5'),
    h6: classAttributes('h6'),
    img: classAttributes('img', ['markdown-emoji']),
    input: [...(defaultSchema.attributes?.input ?? []), ['checked', true]],
    ins: classAttributes('ins'),
    li: classAttributes('li'),
    ol: classAttributes('ol'),
    p: classAttributes('p', ALERT_CLASSES),
    pre: classAttributes('pre', [
      GEOJSON_SOURCE_CLASS,
      MERMAID_SOURCE_CLASS,
      RICH_FENCE_SOURCE_CLASS,
      STL_SOURCE_CLASS,
      TOPOJSON_SOURCE_CLASS,
    ]),
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      'ariaHidden',
      'ariaLabel',
      'role',
      [
        'className',
        'wiki-link-context',
        'wiki-link-leaf',
        'wiki-link-ref-count',
        EXTERNAL_LINK_ICON_CLASS,
        ...CODE_LINK_CLASSES.slice(2),
        /^hljs-./,
        ERROR_CLASS,
        ...GIT_CLASSES,
      ],
    ],
    table: classAttributes('table'),
    tr: classAttributes('tr'),
    ul: classAttributes('ul'),
  },
};

type RemarkCodeHandler = NonNullable<
  NonNullable<RemarkRehypeOptions['handlers']>['code']
>;

const highlightedCodeHandler: RemarkCodeHandler = (state, rawNode) => {
  const node = rawNode as Code;
  const language = node.lang?.split(/\s+/, 1)[0];
  const richSourceClass =
    language?.toLowerCase() === 'mermaid'
      ? MERMAID_SOURCE_CLASS
      : language?.toLowerCase() === 'geojson'
        ? GEOJSON_SOURCE_CLASS
        : language?.toLowerCase() === 'topojson'
          ? TOPOJSON_SOURCE_CLASS
          : language?.toLowerCase() === 'stl'
            ? STL_SOURCE_CLASS
            : null;
  const highlighted =
    language && !richSourceClass ? highlightCode(language, node.value) : null;
  const code = {
    type: 'element' as const,
    tagName: 'code',
    properties: {
      className: [
        ...(language ? [`language-${language}`] : []),
        ...(highlighted === null ? [] : [HIGHLIGHT_CLASS]),
      ],
    },
    children: [
      highlighted === null
        ? { type: 'text' as const, value: node.value ? `${node.value}\n` : '' }
        : { type: 'raw' as const, value: `${highlighted}\n` },
    ],
    ...(node.meta ? { data: { meta: node.meta } } : {}),
  };
  state.patch(node, code);
  const result = state.applyData(node, code);
  const pre = {
    type: 'element' as const,
    tagName: 'pre',
    properties: {
      className: richSourceClass
        ? [RICH_FENCE_SOURCE_CLASS, richSourceClass]
        : [],
    },
    children: [result],
  };
  state.patch(node, pre);
  return pre;
};

const htmlProcessor = unified()
  .use(remarkRehype, {
    allowDangerousHtml: true,
    handlers: { code: highlightedCodeHandler },
  })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeKatex)
  .use(rehypeSlug)
  .use(rehypeStringify);

const emojiProcessor = unified().use(remarkEmoji, { accessible: true });

function transformCustomEmoji(tree: Root): void {
  visit(tree, 'text', (node, index, parent) => {
    if (index === undefined || !parent || !node.value.includes(':')) return;
    const pattern = /:([a-z0-9_+-]+):/g;
    const children: PhrasingContent[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(node.value))) {
      if (!GITHUB_CUSTOM_EMOJI.has(match[1])) continue;
      if (match.index > cursor) {
        children.push({
          type: 'text',
          value: node.value.slice(cursor, match.index),
        });
      }
      children.push({
        type: 'image',
        url: `https://github.githubassets.com/images/icons/emoji/${match[1]}.png?v8`,
        alt: match[0],
        title: null,
        data: { hProperties: { className: ['markdown-emoji'] } },
      });
      cursor = match.index + match[0].length;
    }
    if (children.length === 0) return;
    if (cursor < node.value.length) {
      children.push({ type: 'text', value: node.value.slice(cursor) });
    }
    parent.children.splice(index, 1, ...children);
    return index + children.length;
  });
}

function nodeText(node: { value?: unknown; children?: unknown }): string {
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children
    .map((child) => nodeText(child as { value?: unknown; children?: unknown }))
    .join('');
}

function transformAlerts(tree: Root): void {
  visit(tree, 'blockquote', (node: Blockquote) => {
    const firstBlock = node.children[0];
    if (firstBlock?.type !== 'paragraph') return;
    const firstInline = firstBlock.children[0];
    if (firstInline?.type !== 'alertMarker') return;

    const label = (firstInline as AlertMarker).value;
    const kind = label.toLowerCase() as (typeof ALERT_KINDS)[number];
    firstBlock.children.shift();
    if (firstBlock.children.length === 0) node.children.shift();

    node.data = {
      ...node.data,
      hName: 'div',
      hProperties: {
        ...(node.data?.hProperties ?? {}),
        className: ['markdown-alert', `markdown-alert-${kind}`],
      },
    };
    node.children.unshift({
      type: 'paragraph',
      data: {
        hProperties: { className: ['markdown-alert-title'] },
      },
      children: [
        { type: 'text', value: label[0] + label.slice(1).toLowerCase() },
      ],
    });
  });
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

function codeLinkContent(
  language: { className: string; label: string },
  children: RootContent[],
): RootContent[] {
  const [first, ...rest] = children;
  if (!first) return [languageIcon(language)];

  let leading = first;
  let remainder: RootContent | null = null;
  if (first.type === 'text') {
    const breakAt = first.value.search(/\s/);
    if (breakAt > 0) {
      leading = { ...first, value: first.value.slice(0, breakAt) };
      remainder = { ...first, value: first.value.slice(breakAt) };
    }
  }

  return [
    {
      type: 'emphasis',
      data: {
        hName: 'span',
        hProperties: { className: ['code-link-leading'] },
      },
      children: [languageIcon(language), leading],
    } as RootContent,
    ...(remainder ? [remainder] : []),
    ...rest,
  ];
}

function externalLinkIcon(): PhrasingContent {
  return {
    type: 'emphasis',
    data: {
      hName: 'span',
      hProperties: {
        ariaHidden: 'true',
        className: [EXTERNAL_LINK_ICON_CLASS],
      },
    },
    children: [],
  } as PhrasingContent;
}

function isExternalSiteUrl(url: string): boolean {
  return /^(?:https?:)?\/\//i.test(url);
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
  await emojiProcessor.run(tree);
  transformCustomEmoji(tree);
  transformAlerts(tree);
  if (options.errors) markMarkdownErrors(tree, options.errors);

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
    if (!isExternalSiteUrl(node.url)) return;

    const properties = node.data?.hProperties ?? {};
    const currentClasses = properties.className;
    const classes = Array.isArray(currentClasses)
      ? currentClasses.map(String)
      : currentClasses
        ? [String(currentClasses)]
        : [];
    node.data = {
      ...node.data,
      hProperties: {
        ...properties,
        className: [...classes, EXTERNAL_LINK_CLASS],
      },
    };
    node.children.push(externalLinkIcon());
  });

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
          ...(language
            ? codeLinkContent(language, content.children)
            : content.children),
          ...(referenceCount > 1 ? [referenceCountBadge(referenceCount)] : []),
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
