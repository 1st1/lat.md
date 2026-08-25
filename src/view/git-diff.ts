import type { Root, RootContent } from 'mdast';
import { parse } from '../parser.js';
import type { WikiLink } from '../extensions/wiki-link/types.js';

type DiffKind = 'added' | 'removed';
type SequenceChange<T> =
  | { kind: 'same'; oldValue: T; newValue: T }
  | { kind: 'added'; value: T }
  | { kind: 'removed'; value: T };

type InlineUnit = {
  key: string;
  node: RootContent;
};

type ChildNode = RootContent & { children: RootContent[] };
type DataNode = RootContent & {
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

const MAX_DIFF_CELLS = 1_000_000;
const MIN_INLINE_WORD_OVERLAP = 0.2;
const WORDS = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu;
const WORD_TOKENS = /[\p{L}\p{N}_]+/gu;

function sequenceDiff<T>(
  oldValues: T[],
  newValues: T[],
  key: (value: T) => string,
): SequenceChange<T>[] {
  const oldKeys = oldValues.map(key);
  const newKeys = newValues.map(key);
  if (oldKeys.length * newKeys.length > MAX_DIFF_CELLS) {
    let prefix = 0;
    while (
      prefix < oldKeys.length &&
      prefix < newKeys.length &&
      oldKeys[prefix] === newKeys[prefix]
    ) {
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < oldKeys.length - prefix &&
      suffix < newKeys.length - prefix &&
      oldKeys[oldKeys.length - suffix - 1] ===
        newKeys[newKeys.length - suffix - 1]
    ) {
      suffix++;
    }
    return [
      ...oldValues.slice(0, prefix).map((oldValue, index) => ({
        kind: 'same' as const,
        oldValue,
        newValue: newValues[index],
      })),
      ...oldValues
        .slice(prefix, oldValues.length - suffix)
        .map((value) => ({ kind: 'removed' as const, value })),
      ...newValues
        .slice(prefix, newValues.length - suffix)
        .map((value) => ({ kind: 'added' as const, value })),
      ...oldValues.slice(oldValues.length - suffix).map((oldValue, index) => ({
        kind: 'same' as const,
        oldValue,
        newValue: newValues[newValues.length - suffix + index],
      })),
    ];
  }

  const rows = Array.from(
    { length: oldKeys.length + 1 },
    () => new Uint32Array(newKeys.length + 1),
  );
  for (let oldIndex = oldKeys.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newKeys.length - 1; newIndex >= 0; newIndex--) {
      rows[oldIndex][newIndex] =
        oldKeys[oldIndex] === newKeys[newIndex]
          ? rows[oldIndex + 1][newIndex + 1] + 1
          : Math.max(
              rows[oldIndex + 1][newIndex],
              rows[oldIndex][newIndex + 1],
            );
    }
  }

  const changes: SequenceChange<T>[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldValues.length || newIndex < newValues.length) {
    if (
      oldIndex < oldValues.length &&
      newIndex < newValues.length &&
      oldKeys[oldIndex] === newKeys[newIndex]
    ) {
      changes.push({
        kind: 'same',
        oldValue: oldValues[oldIndex++],
        newValue: newValues[newIndex++],
      });
    } else if (
      newIndex < newValues.length &&
      (oldIndex === oldValues.length ||
        rows[oldIndex][newIndex + 1] > rows[oldIndex + 1][newIndex])
    ) {
      changes.push({ kind: 'added', value: newValues[newIndex++] });
    } else {
      changes.push({ kind: 'removed', value: oldValues[oldIndex++] });
    }
  }
  return changes;
}

function withChildren(node: RootContent): node is ChildNode {
  return 'children' in node && Array.isArray(node.children);
}

function wikiText(node: WikiLink): string {
  return node.data.alias ?? node.value;
}

function nodeText(node: RootContent): string {
  if (node.type === 'wikiLink') return wikiText(node as WikiLink);
  if ('value' in node && typeof node.value === 'string') return node.value;
  return withChildren(node) ? node.children.map(nodeText).join('') : '';
}

function inlineWordOverlap(oldNode: RootContent, newNode: RootContent): number {
  const oldWords = nodeText(oldNode).toLowerCase().match(WORD_TOKENS) ?? [];
  const newWords = nodeText(newNode).toLowerCase().match(WORD_TOKENS) ?? [];
  if (oldWords.length === 0 || newWords.length === 0) {
    return oldWords.length === newWords.length ? 1 : 0;
  }
  const shared = sequenceDiff(oldWords, newWords, (word) => word).filter(
    (change) => change.kind === 'same',
  ).length;
  return shared / (oldWords.length + newWords.length - shared);
}

function wrapperSignature(node: RootContent): string {
  switch (node.type) {
    case 'link':
      return `link:${node.url}:${node.title ?? ''}`;
    case 'linkReference':
      return `link-reference:${node.identifier}:${node.referenceType}`;
    default:
      return node.type;
  }
}

function inlineUnits(node: RootContent, prefix = ''): InlineUnit[] {
  if (node.type === 'text') {
    return [...node.value.matchAll(WORDS)].map((match) => ({
      key: `${prefix}text:${match[0]}`,
      node: { ...structuredClone(node), value: match[0] },
    }));
  }
  if (node.type === 'wikiLink') {
    const wiki = node as WikiLink;
    return [
      {
        key: `${prefix}wiki:${wiki.value}:${wiki.data.alias ?? ''}`,
        node: structuredClone(node),
      },
    ];
  }
  if (withChildren(node)) {
    const nextPrefix = `${prefix}${wrapperSignature(node)}>`;
    return node.children.flatMap((child) =>
      inlineUnits(child, nextPrefix).map((unit) => ({
        key: unit.key,
        node: {
          ...structuredClone(node),
          children: [unit.node],
        } as RootContent,
      })),
    );
  }
  return [
    {
      key: `${prefix}${wrapperSignature(node)}:${nodeText(node)}`,
      node: structuredClone(node),
    },
  ];
}

function wrapInline(node: RootContent, kind: DiffKind): RootContent {
  return {
    type: 'emphasis',
    data: {
      hName: kind === 'added' ? 'ins' : 'del',
      hProperties: { className: [`git-${kind}`] },
    },
    children: [node],
  } as RootContent;
}

function diffInline(
  oldChildren: RootContent[],
  newChildren: RootContent[],
): RootContent[] {
  const oldUnits = oldChildren.flatMap((child) => inlineUnits(child));
  const newUnits = newChildren.flatMap((child) => inlineUnits(child));
  return sequenceDiff(oldUnits, newUnits, (unit) => unit.key).map((change) => {
    switch (change.kind) {
      case 'same':
        return change.newValue.node;
      case 'added':
        return wrapInline(change.value.node, 'added');
      case 'removed':
        return wrapInline(change.value.node, 'removed');
    }
  });
}

function sourceForNode(markdown: string, node: RootContent): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined
    ? `${node.type}:${nodeText(node)}`
    : `${node.type}:${markdown.slice(start, end)}`;
}

function addClass(node: RootContent, kind: DiffKind): RootContent {
  const result = structuredClone(node) as DataNode;
  const properties = result.data?.hProperties ?? {};
  const current = properties.className;
  const classes = Array.isArray(current)
    ? current.map(String)
    : current
      ? [String(current)]
      : [];
  classes.push(`git-${kind}`);
  result.data = {
    ...result.data,
    hName:
      kind === 'removed' && result.type === 'heading'
        ? 'div'
        : result.data?.hName,
    hProperties: { ...properties, className: classes },
  };
  if (kind === 'removed') stripPositions(result);
  return result;
}

function stripPositions(node: RootContent): void {
  delete node.position;
  if (withChildren(node)) node.children.forEach(stripPositions);
}

function pairedNode(
  oldNode: RootContent,
  newNode: RootContent,
  oldMarkdown: string,
  newMarkdown: string,
): RootContent | null {
  if (oldNode.type !== newNode.type) return null;
  if (
    (newNode.type === 'heading' || newNode.type === 'paragraph') &&
    withChildren(oldNode) &&
    withChildren(newNode)
  ) {
    if (inlineWordOverlap(oldNode, newNode) < MIN_INLINE_WORD_OVERLAP) {
      return null;
    }
    return {
      ...structuredClone(newNode),
      children: diffInline(oldNode.children, newNode.children),
    } as RootContent;
  }
  if (
    (newNode.type === 'blockquote' ||
      newNode.type === 'list' ||
      newNode.type === 'listItem') &&
    withChildren(oldNode) &&
    withChildren(newNode)
  ) {
    return {
      ...structuredClone(newNode),
      children: diffBlocks(
        oldNode.children,
        newNode.children,
        oldMarkdown,
        newMarkdown,
      ),
    } as RootContent;
  }
  return null;
}

function diffBlocks(
  oldNodes: RootContent[],
  newNodes: RootContent[],
  oldMarkdown: string,
  newMarkdown: string,
): RootContent[] {
  const changes = sequenceDiff(oldNodes, newNodes, (node) =>
    oldNodes.includes(node)
      ? sourceForNode(oldMarkdown, node)
      : sourceForNode(newMarkdown, node),
  );
  const output: RootContent[] = [];
  for (let index = 0; index < changes.length; ) {
    const change = changes[index];
    if (change.kind === 'same') {
      output.push(structuredClone(change.newValue));
      index++;
      continue;
    }

    const removed: RootContent[] = [];
    const added: RootContent[] = [];
    while (index < changes.length && changes[index].kind !== 'same') {
      const pending = changes[index++];
      if (pending.kind === 'removed') removed.push(pending.value);
      if (pending.kind === 'added') added.push(pending.value);
    }
    const paired = Math.min(removed.length, added.length);
    let pairedCount = 0;
    while (pairedCount < paired) {
      const node = pairedNode(
        removed[pairedCount],
        added[pairedCount],
        oldMarkdown,
        newMarkdown,
      );
      if (!node) break;
      output.push(node);
      pairedCount++;
    }
    output.push(
      ...removed.slice(pairedCount).map((node) => addClass(node, 'removed')),
      ...added.slice(pairedCount).map((node) => addClass(node, 'added')),
    );
  }
  return output;
}

/** Build a renderable Markdown tree with HEAD deletions and local additions. */
export function buildGitDiffTree(
  baseMarkdown: string,
  currentMarkdown: string,
  currentTree?: Root,
): Root {
  const oldTree = parse(baseMarkdown);
  const newTree = currentTree
    ? structuredClone(currentTree)
    : parse(currentMarkdown);
  const oldNodes = oldTree.children.filter((node) => node.type !== 'yaml');
  const newNodes = newTree.children.filter((node) => node.type !== 'yaml');
  return {
    type: 'root',
    children: diffBlocks(oldNodes, newNodes, baseMarkdown, currentMarkdown),
  };
}
