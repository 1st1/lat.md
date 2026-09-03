import {
  createElement,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type {
  ViewCodeBackReference,
  ViewDocumentElement,
  ViewDocumentNode,
  ViewDocumentProperty,
  ViewDocumentTree,
  ViewMarkdownBackReference,
  ViewSectionBackReferences,
} from '../../src/view/protocol';
import {
  MarkdownRichFence,
  type MarkdownRichFenceKind,
} from './MarkdownRichFence';
import { copySectionId } from './section-back-references';

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function reactAttributeName(name: string): string {
  if (/^(?:aria|data)[A-Z]/.test(name)) {
    return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  }
  if (name === 'xLinkHref') return 'xlinkHref';
  return name;
}

function reactStyle(value: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const declaration of value.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim();
    const item = declaration.slice(colon + 1).trim();
    if (!name || !item) continue;
    const property = name.startsWith('--')
      ? name
      : name.replace(/-([a-z])/g, (_match, letter: string) =>
          letter.toUpperCase(),
        );
    style[property] = item;
  }
  return style as CSSProperties;
}

function reactProperty(
  name: string,
  value: ViewDocumentProperty,
): ViewDocumentProperty | CSSProperties | undefined {
  if (
    /^on/i.test(name) ||
    name === 'dangerouslySetInnerHTML' ||
    name === 'srcDoc'
  ) {
    return undefined;
  }
  if (
    ['href', 'src', 'action', 'formAction'].includes(name) &&
    typeof value === 'string' &&
    /^\s*(?:javascript|vbscript):/i.test(value)
  ) {
    return undefined;
  }
  if (name === 'style' && typeof value === 'string') return reactStyle(value);
  if (Array.isArray(value)) return value.join(' ');
  return value;
}

function elementProperties(
  node: ViewDocumentElement,
  key: string,
): Record<string, unknown> {
  const properties: Record<string, unknown> = { key };
  for (const [sourceName, value] of Object.entries(node.properties)) {
    const name = reactAttributeName(sourceName);
    const normalized = reactProperty(name, value);
    if (normalized !== undefined) properties[name] = normalized;
  }
  return properties;
}

function documentNodeText(node: ViewDocumentNode): string {
  if (node.type === 'text') return node.value;
  return node.children.map(documentNodeText).join('');
}

function richFenceKind(
  node: ViewDocumentElement,
): MarkdownRichFenceKind | null {
  if (node.tagName !== 'pre') return null;
  const value = node.properties.className;
  const classNames = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/\s+/)
      : [];
  if (classNames.includes('markdown-mermaid-source')) return 'mermaid';
  if (classNames.includes('markdown-geojson-source')) return 'geojson';
  if (classNames.includes('markdown-topojson-source')) return 'topojson';
  if (classNames.includes('markdown-stl-source')) return 'stl';
  return null;
}

function CodeReference({ reference }: { reference: ViewCodeBackReference }) {
  const extension = reference.path.slice(reference.path.lastIndexOf('.'));
  const language = new Map<string, [string, string]>([
    ['.ts', ['code-language-ts', 'TS']],
    ['.tsx', ['code-language-ts', 'TS']],
    ['.js', ['code-language-js', 'JS']],
    ['.jsx', ['code-language-js', 'JS']],
    ['.py', ['code-language-py', 'PY']],
    ['.rs', ['code-language-rs', 'RS']],
    ['.go', ['code-language-go', 'GO']],
    ['.c', ['code-language-c', 'C']],
    ['.h', ['code-language-c', 'C']],
    ['.dart', ['code-language-dart', 'DART']],
    ['.java', ['code-language-java', 'JAVA']],
  ]).get(extension.toLowerCase()) ?? ['', '</>'];
  return (
    <div className="section-back-reference-item section-back-reference-code">
      <a className="section-back-reference-location" href={reference.url}>
        <span
          aria-hidden="true"
          className={['code-link-language', language[0]]
            .filter(Boolean)
            .join(' ')}
        >
          {language[1]}
        </span>
        <span>
          {reference.path}:{reference.line}
        </span>
      </a>
      <code>{reference.snippet}</code>
    </div>
  );
}

function MarkdownReference({
  reference,
}: {
  reference: ViewMarkdownBackReference;
}) {
  return (
    <div className="section-back-reference-item section-back-reference-markdown">
      <a className="section-back-reference-location" href={reference.url}>
        {reference.breadcrumbs.map((part, index) => (
          <span className="section-back-reference-breadcrumb" key={index}>
            {index > 0 && <span aria-hidden="true">›</span>}
            <span className="section-back-reference-breadcrumb-label">
              {part}
            </span>
          </span>
        ))}
      </a>
      <div className="section-back-reference-paragraph">
        <DocumentNodes nodes={reference.paragraphTree.children} />
      </div>
    </div>
  );
}

function SectionMenu({
  heading,
  index,
  onCopySectionLink,
  onShowSectionOutput,
  section,
  sectionOutputEnabled,
  viewMarkdownUrl,
}: {
  heading: {
    children: ReactNode[] | undefined;
    properties: Record<string, unknown>;
    tagName: string;
  };
  index: number;
  onCopySectionLink?: (headingId: string) => void;
  onShowSectionOutput?: (sectionId: string) => void;
  section: ViewSectionBackReferences;
  sectionOutputEnabled: boolean;
  viewMarkdownUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const count = section.references.length;
  const panelId = `section-back-references-${index}`;
  const countLabel = count === 1 ? '1 reference' : `${count} references`;
  const stop = (callback: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    callback();
  };
  return (
    <>
      {createElement(
        heading.tagName,
        heading.properties,
        heading.children,
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={`Section menu${count > 0 ? `, ${countLabel}` : ''}`}
          className="section-back-reference-toggle"
          key="section-menu-toggle"
          onClick={stop(() => setOpen((value) => !value))}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
          </svg>
          {count > 0 && (
            <span className="section-back-reference-count">{count}</span>
          )}
        </button>,
      )}
      <section
        aria-label={`References to ${section.sectionId}`}
        className="section-back-reference-panel"
        hidden={!open}
        id={panelId}
      >
        {count > 0 ? (
          <>
            <div className="section-back-reference-header">Referenced from</div>
            <div className="section-back-reference-list">
              {section.references.map((reference, referenceIndex) =>
                reference.kind === 'markdown' ? (
                  <MarkdownReference
                    key={`markdown-${reference.sectionId}-${referenceIndex}`}
                    reference={reference}
                  />
                ) : (
                  <CodeReference
                    key={`code-${reference.path}-${reference.line}`}
                    reference={reference}
                  />
                ),
              )}
            </div>
          </>
        ) : (
          <div className="section-back-reference-empty">
            No references to this section
          </div>
        )}
        <div className="section-back-reference-actions">
          {index === 0 && viewMarkdownUrl && (
            <a className="section-back-reference-action" href={viewMarkdownUrl}>
              View Markdown file
            </a>
          )}
          <button
            className="section-back-reference-action"
            onClick={stop(() => onCopySectionLink?.(section.headingId))}
            type="button"
          >
            Copy link to the section
          </button>
          <button
            className="section-back-reference-action"
            onClick={stop(() =>
              copySectionId(section.sectionId, window.navigator.clipboard),
            )}
            type="button"
          >
            Copy section ID
          </button>
          {sectionOutputEnabled && (
            <button
              className="section-back-reference-action"
              onClick={stop(() => onShowSectionOutput?.(section.sectionId))}
              type="button"
            >
              Show <code>lat section</code> output
            </button>
          )}
        </div>
      </section>
    </>
  );
}

type RenderContext = {
  sections: ReadonlyMap<
    string,
    { index: number; section: ViewSectionBackReferences }
  >;
  sectionOutputEnabled: boolean;
  onCopySectionLink?: (headingId: string) => void;
  onShowSectionOutput?: (sectionId: string) => void;
  viewMarkdownUrl?: string;
};

function DocumentElement({
  context,
  node,
  path,
}: {
  context?: RenderContext;
  node: ViewDocumentElement;
  path: string;
}) {
  const properties = elementProperties(node, path);
  const children = VOID_ELEMENTS.has(node.tagName)
    ? undefined
    : node.children.map((child, index) =>
        documentNode(child, `${path}.${index}`, context),
      );
  const fenceKind = richFenceKind(node);
  if (fenceKind) {
    return (
      <MarkdownRichFence
        fallback={createElement(node.tagName, properties, children)}
        key={path}
        kind={fenceKind}
        source={node.children.map(documentNodeText).join('')}
      />
    );
  }
  const headingId =
    /^h[1-6]$/.test(node.tagName) && typeof node.properties.id === 'string'
      ? node.properties.id
      : null;
  const backReferences = headingId ? context?.sections.get(headingId) : null;
  if (!backReferences) {
    return createElement(node.tagName, properties, children);
  }
  return (
    <SectionMenu
      heading={{ children, properties, tagName: node.tagName }}
      index={backReferences.index}
      key={path}
      onCopySectionLink={context?.onCopySectionLink}
      onShowSectionOutput={context?.onShowSectionOutput}
      section={backReferences.section}
      sectionOutputEnabled={context?.sectionOutputEnabled ?? true}
      viewMarkdownUrl={context?.viewMarkdownUrl}
    />
  );
}

function documentNode(
  node: ViewDocumentNode,
  path: string,
  context?: RenderContext,
): ReactNode {
  if (node.type === 'text') return node.value;
  return (
    <DocumentElement context={context} key={path} node={node} path={path} />
  );
}

export function DocumentNodes({
  nodes,
}: {
  nodes: readonly ViewDocumentNode[];
}) {
  return <>{nodes.map((node, index) => documentNode(node, String(index)))}</>;
}

export function MarkdownContent({
  backReferences = [],
  onClick,
  onCopySectionLink,
  onShowSectionOutput,
  sectionOutputEnabled = true,
  tree,
  viewMarkdownUrl,
}: {
  backReferences?: ViewSectionBackReferences[];
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onCopySectionLink?: (headingId: string) => void;
  onShowSectionOutput?: (sectionId: string) => void;
  sectionOutputEnabled?: boolean;
  tree: ViewDocumentTree;
  viewMarkdownUrl?: string;
}) {
  const context: RenderContext = {
    sections: new Map(
      backReferences.map((section, index) => [
        section.headingId,
        { index, section },
      ]),
    ),
    sectionOutputEnabled,
    onCopySectionLink,
    onShowSectionOutput,
    viewMarkdownUrl,
  };

  return (
    <article className="markdown" onClick={onClick}>
      {tree.children.map((node, index) =>
        documentNode(node, String(index), context),
      )}
    </article>
  );
}
