import type {
  ViewDocumentElement,
  ViewDocumentNode,
  ViewDocumentProperty,
  ViewDocumentTree,
} from './protocol.js';

type HastLikeNode = {
  type?: unknown;
  value?: unknown;
  tagName?: unknown;
  properties?: unknown;
  children?: unknown;
};

function propertyValue(value: unknown): ViewDocumentProperty | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string | number =>
        typeof item === 'string' || typeof item === 'number',
    );
  }
  return undefined;
}

function documentNode(node: HastLikeNode): ViewDocumentNode | null {
  if (node.type === 'text' && typeof node.value === 'string') {
    return { type: 'text', value: node.value };
  }
  if (node.type !== 'element' || typeof node.tagName !== 'string') return null;

  const properties: Record<string, ViewDocumentProperty> = {};
  if (node.properties && typeof node.properties === 'object') {
    for (const [name, value] of Object.entries(node.properties)) {
      const normalized = propertyValue(value);
      if (normalized !== undefined) properties[name] = normalized;
    }
  }
  const children = Array.isArray(node.children)
    ? node.children
        .map((child) => documentNode(child as HastLikeNode))
        .filter((child): child is ViewDocumentNode => child !== null)
    : [];
  return {
    type: 'element',
    tagName: node.tagName,
    properties,
    children,
  };
}

/** Strip a sanitized HAST tree to the stable JSON wire representation. */
export function toViewDocumentTree(tree: HastLikeNode): ViewDocumentTree {
  if (tree.type !== 'root' || !Array.isArray(tree.children)) {
    throw new Error('Document adapter did not produce a root node');
  }
  return {
    version: 1,
    type: 'root',
    children: tree.children
      .map((child) => documentNode(child as HastLikeNode))
      .filter((child): child is ViewDocumentNode => child !== null),
  };
}

export function documentTreeUrls(tree: ViewDocumentTree): string[] {
  const urls: string[] = [];
  visitDocumentElements(tree, (element) => {
    for (const name of ['href', 'src']) {
      const value = element.properties[name];
      if (typeof value === 'string') urls.push(value);
    }
  });
  return urls;
}

export function visitDocumentElements(
  tree: ViewDocumentTree,
  visitor: (element: ViewDocumentElement) => void,
): void {
  const visit = (node: ViewDocumentNode): void => {
    if (node.type !== 'element') return;
    visitor(node);
    for (const child of node.children) visit(child);
  };
  for (const child of tree.children) visit(child);
}

function classNames(value: ViewDocumentProperty | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

function isExternalSiteUrl(value: string): boolean {
  return /^(?:https?:)?\/\//i.test(value);
}

function containsElementTag(
  element: ViewDocumentElement,
  tagName: string,
): boolean {
  return element.children.some(
    (child) =>
      child.type === 'element' &&
      (child.tagName === tagName || containsElementTag(child, tagName)),
  );
}

/** Apply parser-neutral presentation to links that leave the current site. */
export function decorateExternalSiteLinks(
  tree: ViewDocumentTree,
): ViewDocumentTree {
  visitDocumentElements(tree, (element) => {
    const href = element.properties.href;
    if (
      element.tagName !== 'a' ||
      typeof href !== 'string' ||
      !isExternalSiteUrl(href)
    ) {
      return;
    }

    const classes = classNames(element.properties.className);
    if (!classes.includes('external-link')) classes.push('external-link');
    element.properties.className = classes;
    if (containsElementTag(element, 'img')) return;

    const alreadyDecorated = element.children.some(
      (child) =>
        child.type === 'element' &&
        child.tagName === 'span' &&
        classNames(child.properties.className).includes('external-link-icon'),
    );
    if (!alreadyDecorated) {
      element.children.push({
        type: 'element',
        tagName: 'span',
        properties: {
          ariaHidden: 'true',
          className: ['external-link-icon'],
        },
        children: [],
      });
    }
  });
  return tree;
}

/** Clone a document tree while structurally rewriting navigable URLs. */
export function rewriteDocumentTreeUrls(
  tree: ViewDocumentTree,
  rewrite: (value: string) => string,
): ViewDocumentTree {
  const cloneNode = (node: ViewDocumentNode): ViewDocumentNode => {
    if (node.type === 'text') return { ...node };
    const properties = { ...node.properties };
    for (const name of ['href', 'src']) {
      const value = properties[name];
      if (typeof value === 'string') properties[name] = rewrite(value);
    }
    return {
      ...node,
      properties,
      children: node.children.map(cloneNode),
    };
  };
  return { ...tree, children: tree.children.map(cloneNode) };
}

export function textDocumentTree(value: string): ViewDocumentTree {
  return { version: 1, type: 'root', children: [{ type: 'text', value }] };
}
