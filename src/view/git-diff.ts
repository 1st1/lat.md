import type {
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableRow,
} from 'mdast';
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
const MIN_INLINE_WORD_OVERLAP = 0.6;
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

function tableShape(table: Table): { columns: number; align: string[] } | null {
  const columns = table.children[0]?.children.length ?? 0;
  if (
    columns === 0 ||
    table.children.some((row) => row.children.length !== columns)
  ) {
    return null;
  }
  return {
    columns,
    align: Array.from(
      { length: columns },
      (_, index) => table.align?.[index] ?? '',
    ),
  };
}

function tablesAreCompatible(oldTable: Table, newTable: Table): boolean {
  const oldShape = tableShape(oldTable);
  const newShape = tableShape(newTable);
  return (
    oldShape !== null &&
    newShape !== null &&
    oldShape.columns === newShape.columns &&
    oldShape.align.every((align, index) => align === newShape.align[index])
  );
}

function tableRowSimilarity(oldRow: TableRow, newRow: TableRow): number {
  if (oldRow.children.length !== newRow.children.length) return 0;
  const matchingCells = oldRow.children.filter(
    (cell, index) => nodeText(cell) === nodeText(newRow.children[index]),
  ).length;
  return Math.max(
    matchingCells / oldRow.children.length,
    inlineWordOverlap(oldRow, newRow),
  );
}

function alignChangedTableRows(
  oldRows: TableRow[],
  newRows: TableRow[],
): SequenceChange<TableRow>[] {
  if (oldRows.length * newRows.length > MAX_DIFF_CELLS) {
    const paired = Math.min(oldRows.length, newRows.length);
    return [
      ...oldRows.slice(0, paired).map((oldValue, index) => ({
        kind: 'same' as const,
        oldValue,
        newValue: newRows[index],
      })),
      ...oldRows
        .slice(paired)
        .map((value) => ({ kind: 'removed' as const, value })),
      ...newRows
        .slice(paired)
        .map((value) => ({ kind: 'added' as const, value })),
    ];
  }

  const costs = Array.from(
    { length: oldRows.length + 1 },
    () => new Float64Array(newRows.length + 1),
  );
  for (let oldIndex = oldRows.length; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newRows.length; newIndex >= 0; newIndex--) {
      if (oldIndex === oldRows.length) {
        costs[oldIndex][newIndex] = newRows.length - newIndex;
      } else if (newIndex === newRows.length) {
        costs[oldIndex][newIndex] = oldRows.length - oldIndex;
      } else {
        const pairCost =
          costs[oldIndex + 1][newIndex + 1] +
          1.5 -
          tableRowSimilarity(oldRows[oldIndex], newRows[newIndex]);
        costs[oldIndex][newIndex] = Math.min(
          pairCost,
          costs[oldIndex + 1][newIndex] + 1,
          costs[oldIndex][newIndex + 1] + 1,
        );
      }
    }
  }

  const changes: SequenceChange<TableRow>[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  const epsilon = 1e-9;
  while (oldIndex < oldRows.length || newIndex < newRows.length) {
    if (oldIndex === oldRows.length) {
      changes.push({ kind: 'added', value: newRows[newIndex++] });
      continue;
    }
    if (newIndex === newRows.length) {
      changes.push({ kind: 'removed', value: oldRows[oldIndex++] });
      continue;
    }

    const currentCost = costs[oldIndex][newIndex];
    const pairCost =
      costs[oldIndex + 1][newIndex + 1] +
      1.5 -
      tableRowSimilarity(oldRows[oldIndex], newRows[newIndex]);
    const removeCost = costs[oldIndex + 1][newIndex] + 1;
    const addCost = costs[oldIndex][newIndex + 1] + 1;
    const oldRemaining = oldRows.length - oldIndex;
    const newRemaining = newRows.length - newIndex;
    const pairIsBest = Math.abs(pairCost - currentCost) < epsilon;
    const pairIsStrictlyBest =
      pairCost < removeCost - epsilon && pairCost < addCost - epsilon;

    if (pairIsBest && (pairIsStrictlyBest || oldRemaining === newRemaining)) {
      changes.push({
        kind: 'same',
        oldValue: oldRows[oldIndex++],
        newValue: newRows[newIndex++],
      });
    } else if (
      oldRemaining > newRemaining &&
      Math.abs(removeCost - currentCost) < epsilon
    ) {
      changes.push({ kind: 'removed', value: oldRows[oldIndex++] });
    } else if (Math.abs(addCost - currentCost) < epsilon) {
      changes.push({ kind: 'added', value: newRows[newIndex++] });
    } else if (Math.abs(removeCost - currentCost) < epsilon) {
      changes.push({ kind: 'removed', value: oldRows[oldIndex++] });
    } else {
      changes.push({
        kind: 'same',
        oldValue: oldRows[oldIndex++],
        newValue: newRows[newIndex++],
      });
    }
  }
  return changes;
}

function diffTableRow(oldRow: TableRow, newRow: TableRow): TableRow {
  return {
    ...structuredClone(newRow),
    children: newRow.children.map((newCell, index) => ({
      ...structuredClone(newCell),
      children: diffInline(
        oldRow.children[index].children,
        newCell.children,
      ) as PhrasingContent[],
    })),
  };
}

function diffTableRows(
  oldRows: TableRow[],
  newRows: TableRow[],
  oldMarkdown: string,
  newMarkdown: string,
): TableRow[] {
  const output = [diffTableRow(oldRows[0], newRows[0])];
  const oldBody = oldRows.slice(1);
  const newBody = newRows.slice(1);
  const changes = sequenceDiff(oldBody, newBody, (row) =>
    oldBody.includes(row)
      ? sourceForNode(oldMarkdown, row)
      : sourceForNode(newMarkdown, row),
  );

  for (let index = 0; index < changes.length; ) {
    const change = changes[index];
    if (change.kind === 'same') {
      output.push(structuredClone(change.newValue));
      index++;
      continue;
    }

    const removed: TableRow[] = [];
    const added: TableRow[] = [];
    while (index < changes.length && changes[index].kind !== 'same') {
      const pending = changes[index++];
      if (pending.kind === 'removed') removed.push(pending.value);
      if (pending.kind === 'added') added.push(pending.value);
    }
    output.push(
      ...alignChangedTableRows(removed, added).map((rowChange) => {
        switch (rowChange.kind) {
          case 'same':
            return diffTableRow(rowChange.oldValue, rowChange.newValue);
          case 'added':
            return addClass(rowChange.value, 'added') as TableRow;
          case 'removed':
            return addClass(rowChange.value, 'removed') as TableRow;
        }
      }),
    );
  }
  return output;
}

function diffTable(
  oldTable: Table,
  newTable: Table,
  oldMarkdown: string,
  newMarkdown: string,
): Table | null {
  if (!tablesAreCompatible(oldTable, newTable)) return null;
  return {
    ...structuredClone(newTable),
    children: diffTableRows(
      oldTable.children,
      newTable.children,
      oldMarkdown,
      newMarkdown,
    ),
  };
}

function isDisplayMath(node: RootContent): boolean {
  return (
    node.type === 'math' ||
    (node.type === 'code' &&
      node.lang?.split(/\s+/, 1)[0].toLowerCase() === 'math')
  );
}

function wrapDisplayMath(node: RootContent, kind: DiffKind): RootContent {
  const child = structuredClone(node);
  if (kind === 'removed') stripPositions(child);
  return {
    type: 'blockquote',
    data: {
      hName: 'div',
      hProperties: {
        className: ['git-math-block', `git-${kind}`],
      },
    },
    children: [child],
  } as RootContent;
}

function addClass(node: RootContent, kind: DiffKind): RootContent {
  if (isDisplayMath(node)) return wrapDisplayMath(node, kind);
  const result = structuredClone(node) as DataNode;
  const properties = result.data?.hProperties ?? {};
  const current = properties.className;
  const classes = Array.isArray(current)
    ? current.map(String)
    : current
      ? [String(current)]
      : [];
  if (result.type === 'code' && result.lang) {
    classes.push(`language-${result.lang}`);
  }
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
  if (oldNode.type === 'table' && newNode.type === 'table') {
    return diffTable(oldNode, newNode, oldMarkdown, newMarkdown);
  }
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
