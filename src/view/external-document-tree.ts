import type { AbstractBlock, Inline } from '@asciidoctor/core';
import type { RstNode } from 'rst-compiler';
import { asciidocCompatibleContent } from '../external-documents.js';
import {
  decorateExternalSiteLinks,
  toViewDocumentTree,
} from './document-tree.js';
import { highlightCode } from './highlight.js';
import type {
  ViewDocumentElement,
  ViewDocumentNode,
  ViewDocumentProperty,
  ViewDocumentTree,
} from './protocol.js';

type Properties = Record<string, ViewDocumentProperty>;

function text(value: string): ViewDocumentNode {
  return { type: 'text', value };
}

function element(
  tagName: string,
  children: ViewDocumentNode[] = [],
  properties: Properties = {},
): ViewDocumentElement {
  return { type: 'element', tagName, properties, children };
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || /^\s*(?:data|javascript|vbscript):/i.test(url)) return null;
  return url;
}

function codeBlock(source: string, language?: string | null): ViewDocumentNode {
  const normalizedLanguage = language?.trim().toLowerCase() || null;
  const highlighted = normalizedLanguage
    ? highlightCode(normalizedLanguage, source)
    : null;
  const children = highlighted
    ? toViewDocumentTree(highlighted).children
    : [text(source ? `${source}\n` : '')];
  const className = [
    ...(normalizedLanguage ? [`language-${normalizedLanguage}`] : []),
    ...(highlighted ? ['hljs'] : []),
  ];
  return element('pre', [
    element(
      'code',
      highlighted ? [...children, text('\n')] : children,
      className.length > 0 ? { className } : {},
    ),
  ]);
}

type RstData = Record<string, unknown>;

function rstData(node: RstNode): RstData {
  const value = node.toObject().data;
  return value && typeof value === 'object' ? (value as RstData) : {};
}

function rstInlineChildren(
  nodes: readonly RstNode[],
  render: (node: RstNode) => ViewDocumentNode[],
): ViewDocumentNode[] {
  return nodes.flatMap(render);
}

function normalizeRstName(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9\-_.:+<>]/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replace(/^[-]*/, '')
    .replace(/[-]*$/, '');
}

async function restructuredTextTree(
  content: string,
): Promise<ViewDocumentTree> {
  const { RstToHtmlCompiler } = await import('rst-compiler');
  const parsed = new RstToHtmlCompiler().parse(content, {
    disableErrors: true,
    disableWarnings: true,
  });

  const properties = (node: RstNode): Properties => {
    const id = parsed.htmlAttrResolver.getNodeHtmlId(node);
    const className = parsed.htmlAttrResolver.getNodeHtmlClasses(node);
    return {
      ...(id ? { id } : {}),
      ...(className.length > 0 ? { className } : {}),
    };
  };
  const linkableNodes = new Map<string, RstNode>(
    parsed.simpleNameResolver.nodesLinkableFromOutside,
  );
  for (const node of parsed.root.findAllChildren('HyperlinkTarget')) {
    const label = (node as RstNode & { label?: string }).label;
    if (label) linkableNodes.set(normalizeRstName(label), node);
  }

  const linkedNodeUrl = (
    node: RstNode,
    visited = new Set<RstNode>(),
  ): string | null => {
    if (visited.has(node)) return null;
    visited.add(node);
    if (node.nodeType === 'HyperlinkTarget') {
      const target = (node as RstNode & { target?: string }).target ?? '';
      const alias = (node as RstNode & { isAlias?: boolean }).isAlias;
      if (alias) {
        const linked = linkableNodes.get(
          normalizeRstName(target.replace(/_$/, '')),
        );
        return linked ? linkedNodeUrl(linked, visited) : null;
      }
      if (target) return safeUrl(target);
    }
    const id = parsed.htmlAttrResolver.getNodeHtmlId(node);
    return id ? `#${id}` : null;
  };

  const hyperlinkUrl = (node: RstNode): string | null => {
    const link = node as RstNode & {
      isAlias?: boolean;
      isAnonymous?: boolean;
      isEmbeded?: boolean;
      target?: string;
    };
    if (link.isAnonymous && !link.isEmbeded) {
      const target =
        parsed.simpleNameResolver.anonymousHyperlinkRefToTarget.get(
          node as never,
        );
      return target ? linkedNodeUrl(target) : null;
    }
    const rawTarget = link.target ?? '';
    const targetName = link.isAlias ? rawTarget.replace(/_$/, '') : rawTarget;
    const linked = linkableNodes.get(normalizeRstName(targetName));
    return linked ? linkedNodeUrl(linked) : safeUrl(rawTarget);
  };

  const render = (node: RstNode): ViewDocumentNode[] => {
    const data = rstData(node);
    const children = () => rstInlineChildren(node.children, render);
    switch (node.nodeType) {
      case 'Document':
        return children();
      case 'Section': {
        const level = Number(data.level ?? 1);
        return [
          element(
            `h${Math.max(1, Math.min(6, level))}`,
            children(),
            properties(node),
          ),
        ];
      }
      case 'Paragraph':
        return [element('p', children(), properties(node))];
      case 'Text':
        return [text(node.textContent)];
      case 'Emphasis':
        return [element('em', [text(node.textContent)], properties(node))];
      case 'StrongEmphasis':
        return [element('strong', [text(node.textContent)], properties(node))];
      case 'InlineLiteral':
      case 'InterpretedText':
        return [element('code', [text(node.textContent)], properties(node))];
      case 'HyperlinkRef': {
        const href = hyperlinkUrl(node);
        if (!href) return [text(node.textContent)];
        return [
          element('a', [text(node.textContent)], {
            ...properties(node),
            href,
          }),
        ];
      }
      case 'InlineInternalTarget':
        return [element('span', [text(node.textContent)], properties(node))];
      case 'LiteralBlock':
      case 'DoctestBlock':
        return [codeBlock(node.rawTextContent || node.textContent)];
      case 'Blockquote':
        return [element('blockquote', children(), properties(node))];
      case 'BlockquoteAttribution':
        return [element('footer', children(), properties(node))];
      case 'Transition':
        return [element('hr', [], properties(node))];
      case 'LineBlock':
        return [element('p', children(), properties(node))];
      case 'LineBlockLine':
        return [...children(), element('br')];
      case 'BulletList':
        return [element('ul', children(), properties(node))];
      case 'EnumeratedList':
        return [element('ol', children(), properties(node))];
      case 'BulletListItem':
        return [element('li', children(), properties(node))];
      case 'DefinitionList':
      case 'FieldList':
      case 'OptionList':
        return [element('dl', children(), properties(node))];
      case 'DefinitionListItem': {
        const item = node as RstNode & {
          term: readonly RstNode[];
          classifiers: readonly (readonly RstNode[])[];
          definition: readonly RstNode[];
        };
        const term = item.term.flatMap(render);
        const classifiers = item.classifiers.map((classifier) =>
          classifier.flatMap(render),
        );
        const definition = item.definition.flatMap(render);
        return [
          element('dt', [
            ...term,
            ...classifiers.flatMap((classifier) => [
              text(' : '),
              ...classifier,
            ]),
          ]),
          element('dd', definition),
        ];
      }
      case 'FieldListItem': {
        const item = node as RstNode & {
          name: readonly RstNode[];
          body: readonly RstNode[];
        };
        return [
          element('dt', item.name.flatMap(render)),
          element('dd', item.body.flatMap(render)),
        ];
      }
      case 'OptionListItem': {
        const options = (
          node as RstNode & {
            options: readonly {
              name: string;
              delimiter?: string;
              rawArgName?: string;
            }[];
          }
        ).options;
        return [
          element('dt', [
            text(
              options
                .map(
                  (option) =>
                    `${option.name}${option.delimiter ?? ''}${option.rawArgName ?? ''}`,
                )
                .join(', '),
            ),
          ]),
          element('dd', children()),
        ];
      }
      case 'Table': {
        const headRows = (node as RstNode & { headRows?: readonly RstNode[] })
          .headRows;
        const bodyRows = (node as RstNode & { bodyRows?: readonly RstNode[] })
          .bodyRows;
        return [
          element('table', [
            ...(headRows?.length
              ? [element('thead', headRows.flatMap(render))]
              : []),
            element('tbody', (bodyRows ?? node.children).flatMap(render)),
          ]),
        ];
      }
      case 'TableRow':
        return [element('tr', children())];
      case 'TableCell': {
        const cell = node as RstNode & { colSpan?: number; rowSpan?: number };
        const parent = node.parent;
        const tagName =
          parent?.nodeType === 'TableRow' &&
          (parent as RstNode & { isHeadRow?: boolean }).isHeadRow
            ? 'th'
            : 'td';
        return [
          element(tagName, children(), {
            ...(cell.colSpan && cell.colSpan > 1
              ? { colSpan: cell.colSpan }
              : {}),
            ...(cell.rowSpan && cell.rowSpan > 1
              ? { rowSpan: cell.rowSpan }
              : {}),
          }),
        ];
      }
      case 'Directive': {
        const directive = String(data.directive ?? '').toLowerCase();
        const rawBody =
          typeof data.rawBodyText === 'string' ? data.rawBodyText : '';
        if (['code', 'code-block', 'sourcecode'].includes(directive)) {
          const language = (
            node as RstNode & { initContentText?: string }
          ).initContentText
            ?.trim()
            .split(/\s+/, 1)[0];
          return [codeBlock(rawBody || node.textContent, language)];
        }
        if (directive === 'image' || directive === 'figure') {
          const src = safeUrl(
            (node as RstNode & { initContentText?: string }).initContentText,
          );
          return src
            ? [element('img', [], { src, alt: String(data.alt ?? '') })]
            : [];
        }
        if (
          [
            'attention',
            'caution',
            'danger',
            'error',
            'hint',
            'important',
            'note',
            'tip',
            'warning',
          ].includes(directive)
        ) {
          return [
            element(
              'div',
              [
                element(
                  'p',
                  [text(directive[0].toUpperCase() + directive.slice(1))],
                  {
                    className: ['markdown-alert-title'],
                  },
                ),
                ...children(),
              ],
              {
                className: [
                  'markdown-alert',
                  `markdown-alert-${directive === 'hint' ? 'tip' : directive}`,
                ],
              },
            ),
          ];
        }
        if (directive === 'raw') {
          return rawBody ? [codeBlock(rawBody)] : [];
        }
        return children();
      }
      case 'FootnoteRef':
      case 'CitationRef':
        return [element('sup', [text(node.textContent)], properties(node))];
      case 'FootnoteDef':
      case 'CitationDef':
        return [element('div', children(), properties(node))];
      case 'Comment':
      case 'HyperlinkTarget':
      case 'SubstitutionDef':
        return [];
      default:
        return node.children.length > 0 ? children() : [text(node.textContent)];
    }
  };

  return { version: 1, type: 'root', children: render(parsed.root) };
}

type AsciiBlock = AbstractBlock & {
  _text?: string;
  getItems?: () => unknown[];
  getSource?: () => string;
  rows?: {
    toObject: () => { head: unknown[][]; body: unknown[][]; foot: unknown[][] };
  };
};

type AsciiCell = {
  _text?: string;
  colspan?: number;
  rowspan?: number;
};

type AsciiInlineOwner = {
  applySubs: (
    value: string,
    substitutions?: string[],
  ) => Promise<string | string[]>;
  subs?: string[];
};

const ASCIIDOC_NORMAL_SUBSTITUTIONS = [
  'specialcharacters',
  'quotes',
  'attributes',
  'replacements',
  'macros',
  'post_replacements',
];

function decodeAsciiEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|apos|gt|lt|quot));/gi,
    (match, decimal: string, hex: string, named: string) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      return (
        {
          amp: '&',
          apos: "'",
          gt: '>',
          lt: '<',
          quot: '"',
        }[named.toLowerCase()] ?? match
      );
    },
  );
}

/** Convert Asciidoctor's native inline nodes into document-tree tokens. */
class AsciiInlineProjector {
  private readonly tokens: ViewDocumentNode[][] = [];

  private token(nodes: ViewDocumentNode | ViewDocumentNode[]): string {
    const index = this.tokens.push(Array.isArray(nodes) ? nodes : [nodes]) - 1;
    return `\u{e000}${index}\u{e001}`;
  }

  private properties(node: Inline): Properties {
    const id = node.getId();
    const className = node.getRoles();
    return {
      ...(id ? { id } : {}),
      ...(className.length > 0 ? { className } : {}),
    };
  }

  decode(value: string): ViewDocumentNode[] {
    const nodes: ViewDocumentNode[] = [];
    let cursor = 0;
    for (const match of value.matchAll(/\u{e000}(\d+)\u{e001}/gu)) {
      const index = match.index ?? 0;
      if (index > cursor) {
        nodes.push(text(decodeAsciiEntities(value.slice(cursor, index))));
      }
      nodes.push(...(this.tokens[Number(match[1])] ?? []));
      cursor = index + match[0].length;
    }
    if (cursor < value.length) {
      nodes.push(text(decodeAsciiEntities(value.slice(cursor))));
    }
    return nodes;
  }

  async project(
    owner: AsciiInlineOwner,
    value: string,
  ): Promise<ViewDocumentNode[]> {
    const substitutions =
      owner.subs && owner.subs.length > 0
        ? owner.subs
        : ASCIIDOC_NORMAL_SUBSTITUTIONS;
    const converted = await owner.applySubs(value, substitutions);
    return this.decode(
      Array.isArray(converted) ? converted.join('\n') : converted,
    );
  }

  convert(node: Inline): string {
    const content = this.decode(node.getText() ?? '');
    const properties = this.properties(node);
    switch (node.getContext()) {
      case 'quoted': {
        const tagName =
          {
            emphasis: 'em',
            mark: 'mark',
            monospaced: 'code',
            strong: 'strong',
            subscript: 'sub',
            superscript: 'sup',
            unquoted: 'span',
          }[node.getType() ?? ''] ?? 'span';
        if (node.getType() === 'double') {
          return this.token([text('“'), ...content, text('”')]);
        }
        if (node.getType() === 'single') {
          return this.token([text('‘'), ...content, text('’')]);
        }
        return this.token(element(tagName, content, properties));
      }
      case 'anchor': {
        if (node.getType() === 'ref' || node.getType() === 'bibref') {
          return this.token(
            element('span', content, {
              ...properties,
              ...(node.getId() ? { id: node.getId() as string } : {}),
            }),
          );
        }
        const href = safeUrl(node.getTarget());
        return this.token(
          href
            ? element('a', content.length > 0 ? content : [text(href)], {
                ...properties,
                href,
              })
            : content,
        );
      }
      case 'image': {
        const src = safeUrl(node.getTarget());
        return this.token(
          src
            ? element('img', [], {
                ...properties,
                src,
                alt: node.getAlt(),
              })
            : content,
        );
      }
      case 'break':
        return this.token([...content, element('br')]);
      case 'button':
        return this.token(element('b', content, { className: ['button'] }));
      case 'callout':
        return this.token(
          element('b', [text(`(${node.getText() ?? ''})`)], {
            className: ['conum'],
          }),
        );
      case 'footnote':
        return this.token(
          element(
            'sup',
            [text(String(node.getAttribute('index') ?? node.getText() ?? ''))],
            { className: ['footnote'] },
          ),
        );
      case 'indexterm':
        return node.getType() === 'visible' ? this.token(content) : '';
      case 'kbd': {
        const keys = node.getAttribute('keys');
        const values = Array.isArray(keys) ? keys.map(String) : [];
        return this.token(
          values.flatMap((key, index) => [
            ...(index > 0 ? [text('+')] : []),
            element('kbd', [text(key)]),
          ]),
        );
      }
      case 'menu': {
        const values = [
          node.getAttribute('menu'),
          ...(Array.isArray(node.getAttribute('submenus'))
            ? (node.getAttribute('submenus') as unknown[])
            : []),
          node.getAttribute('menuitem'),
        ].filter((value) => value != null && value !== '');
        return this.token(
          element('span', [text(values.map(String).join(' › '))], {
            className: ['menuseq'],
          }),
        );
      }
      default:
        return this.token(content);
    }
  }
}

function asciiSource(node: AsciiBlock): string {
  return node.getSource?.() ?? '';
}

function asciiNodeProperties(node: AsciiBlock): Properties {
  const id = node.getId();
  const className = node.getRoles();
  return {
    ...(id ? { id } : {}),
    ...(className.length > 0 ? { className } : {}),
  };
}

function asciiRawText(value: unknown): string {
  return value && typeof value === 'object' && '_text' in value
    ? String((value as { _text?: unknown })._text ?? '')
    : '';
}

async function asciiTable(
  node: AsciiBlock,
  projector: AsciiInlineProjector,
): Promise<ViewDocumentNode> {
  const rows = node.rows?.toObject() ?? { head: [], body: [], foot: [] };
  const renderRows = async (source: unknown[][], header: boolean) => {
    const result: ViewDocumentNode[] = [];
    for (const row of source) {
      const cells: ViewDocumentNode[] = [];
      for (const rawCell of row) {
        const cell = rawCell as AsciiCell;
        cells.push(
          element(
            header ? 'th' : 'td',
            await projector.project(
              cell as unknown as AsciiInlineOwner,
              asciiRawText(cell),
            ),
            {
              ...(cell.colspan && cell.colspan > 1
                ? { colSpan: cell.colspan }
                : {}),
              ...(cell.rowspan && cell.rowspan > 1
                ? { rowSpan: cell.rowspan }
                : {}),
            },
          ),
        );
      }
      result.push(element('tr', cells));
    }
    return result;
  };
  return element('table', [
    ...(rows.head.length
      ? [element('thead', await renderRows(rows.head, true))]
      : []),
    element('tbody', await renderRows(rows.body, false)),
    ...(rows.foot.length
      ? [element('tfoot', await renderRows(rows.foot, false))]
      : []),
  ]);
}

async function asciidocTree(content: string): Promise<ViewDocumentTree> {
  const { load } = await import('@asciidoctor/core');
  const document = await load(asciidocCompatibleContent(content), {
    safe: 'secure',
    sourcemap: true,
    attributes: { showtitle: true },
  });
  const lines = content.split('\n');
  const documentTitle = document.getAttribute('doctitle');
  const rawDocumentTitle =
    typeof documentTitle === 'string' ? documentTitle : null;
  const projector = new AsciiInlineProjector();
  const originalConverter = document.getConverter();
  document.setConverter(projector);
  const sectionOffset = rawDocumentTitle ? 1 : 0;

  const sectionTitle = (node: AsciiBlock): string => {
    const line = node.getLineNumber();
    const raw = line ? lines[line - 1] : undefined;
    const match = raw ? /^={1,6}\s+(.+)$/.exec(raw) : null;
    return match?.[1] ?? String(node.getTitle() ?? '');
  };

  let render: (sourceNode: AbstractBlock) => Promise<ViewDocumentNode[]>;
  const renderMany = async (
    sourceNodes: readonly AbstractBlock[],
  ): Promise<ViewDocumentNode[]> => {
    const result: ViewDocumentNode[] = [];
    for (const sourceNode of sourceNodes)
      result.push(...(await render(sourceNode)));
    return result;
  };

  const renderListItem = async (raw: unknown): Promise<ViewDocumentNode> => {
    const item = raw as AsciiBlock;
    return element('li', [
      ...(await projector.project(
        item as unknown as AsciiInlineOwner,
        asciiRawText(item),
      )),
      ...(await renderMany(item.getBlocks())),
    ]);
  };

  render = async (sourceNode: AbstractBlock): Promise<ViewDocumentNode[]> => {
    const node = sourceNode as AsciiBlock;
    const context = node.getContext();
    const childNodes = () => renderMany(node.getBlocks());
    switch (context) {
      case 'preamble':
      case 'document':
        return await childNodes();
      case 'section': {
        const level = Math.max(
          1,
          Math.min(6, (node.getLevel() ?? node.level ?? 1) + sectionOffset),
        );
        return [
          element(
            `h${level}`,
            await projector.project(
              node as unknown as AsciiInlineOwner,
              sectionTitle(node),
            ),
            asciiNodeProperties(node),
          ),
          ...(await childNodes()),
        ];
      }
      case 'paragraph':
        return [
          element(
            'p',
            await projector.project(
              node as unknown as AsciiInlineOwner,
              asciiSource(node),
            ),
            asciiNodeProperties(node),
          ),
        ];
      case 'ulist':
      case 'olist':
      case 'colist': {
        const tagName = context === 'ulist' ? 'ul' : 'ol';
        return [
          element(
            tagName,
            await Promise.all((node.getItems?.() ?? []).map(renderListItem)),
            asciiNodeProperties(node),
          ),
        ];
      }
      case 'dlist': {
        const entries = node.getItems?.() ?? [];
        const descriptionNodes: ViewDocumentNode[] = [];
        for (const entry of entries) {
          if (!Array.isArray(entry)) continue;
          const terms = Array.isArray(entry[0]) ? entry[0] : [];
          const description = entry[1] as AsciiBlock | null;
          for (const term of terms) {
            descriptionNodes.push(
              element(
                'dt',
                await projector.project(
                  term as unknown as AsciiInlineOwner,
                  asciiRawText(term),
                ),
              ),
            );
          }
          descriptionNodes.push(
            element('dd', [
              ...(description
                ? await projector.project(
                    description as unknown as AsciiInlineOwner,
                    asciiRawText(description),
                  )
                : []),
              ...(description ? await renderMany(description.getBlocks()) : []),
            ]),
          );
        }
        return [element('dl', descriptionNodes, asciiNodeProperties(node))];
      }
      case 'listing':
      case 'literal': {
        const language =
          context === 'listing' && node.getStyle() === 'source'
            ? String(node.getAttribute('language') ?? '')
            : null;
        return [codeBlock(asciiSource(node), language)];
      }
      case 'stem':
        return [codeBlock(asciiSource(node), 'text')];
      case 'quote':
      case 'verse': {
        const contents = await childNodes();
        return [
          element(
            'blockquote',
            contents.length > 0
              ? contents
              : [
                  element(
                    'p',
                    await projector.project(
                      node as unknown as AsciiInlineOwner,
                      asciiSource(node),
                    ),
                  ),
                ],
            asciiNodeProperties(node),
          ),
        ];
      }
      case 'admonition': {
        const kind = String(node.getStyle() ?? 'note').toLowerCase();
        const body = await childNodes();
        return [
          element(
            'div',
            [
              element('p', [text(kind[0].toUpperCase() + kind.slice(1))], {
                className: ['markdown-alert-title'],
              }),
              ...(body.length > 0
                ? body
                : [
                    element(
                      'p',
                      await projector.project(
                        node as unknown as AsciiInlineOwner,
                        asciiSource(node),
                      ),
                    ),
                  ]),
            ],
            {
              ...asciiNodeProperties(node),
              className: [
                'markdown-alert',
                `markdown-alert-${kind === 'hint' ? 'tip' : kind}`,
              ],
            },
          ),
        ];
      }
      case 'image': {
        const src = safeUrl(node.getAttribute('target'));
        return src
          ? [
              element('img', [], {
                ...asciiNodeProperties(node),
                src,
                alt: String(node.getAttribute('alt') ?? ''),
              }),
            ]
          : [];
      }
      case 'table':
        return [await asciiTable(node, projector)];
      case 'thematic_break':
      case 'page_break':
        return [element('hr', [], asciiNodeProperties(node))];
      case 'floating_title':
      case 'discrete_heading': {
        const level = Math.max(
          1,
          Math.min(6, (node.getLevel() ?? node.level ?? 1) + 1),
        );
        return [
          element(
            `h${level}`,
            await projector.project(
              node as unknown as AsciiInlineOwner,
              sectionTitle(node),
            ),
            asciiNodeProperties(node),
          ),
        ];
      }
      case 'pass':
        return asciiSource(node) ? [codeBlock(asciiSource(node))] : [];
      case 'open':
      case 'example':
      case 'sidebar': {
        const contents = await childNodes();
        return [
          element(
            'div',
            contents.length > 0
              ? contents
              : [
                  element(
                    'p',
                    await projector.project(
                      node as unknown as AsciiInlineOwner,
                      asciiSource(node),
                    ),
                  ),
                ],
            {
              ...asciiNodeProperties(node),
              className: [`asciidoc-${context}`, ...node.getRoles()],
            },
          ),
        ];
      }
      default: {
        const contents = await childNodes();
        if (contents.length > 0) return contents;
        const source = asciiSource(node);
        return source
          ? [
              element(
                'p',
                await projector.project(
                  node as unknown as AsciiInlineOwner,
                  source,
                ),
              ),
            ]
          : [];
      }
    }
  };

  try {
    const children: ViewDocumentNode[] = [];
    if (rawDocumentTitle) {
      children.push(
        element(
          'h1',
          await projector.project(
            document as unknown as AsciiInlineOwner,
            rawDocumentTitle,
          ),
          document.getId() ? { id: document.getId() as string } : {},
        ),
      );
    }
    children.push(...(await renderMany(document.getBlocks())));
    return { version: 1, type: 'root', children };
  } finally {
    document.setConverter(originalConverter);
  }
}

/** Reflect a native non-Markdown parser AST into the browser document tree. */
export async function renderExternalDocumentTree(
  format: 'asciidoc' | 'restructuredtext',
  content: string,
): Promise<ViewDocumentTree> {
  const tree =
    format === 'restructuredtext'
      ? await restructuredTextTree(content)
      : await asciidocTree(content);
  return decorateExternalSiteLinks(tree);
}
