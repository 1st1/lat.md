import type {
  ViewExternalFile,
  ViewGitFileStatus,
  ViewIndex,
} from '../../src/view/protocol';

export type FileTreeNode =
  | {
      kind: 'directory';
      name: string;
      path: string;
      children: FileTreeNode[];
    }
  | {
      kind: 'file';
      name: string;
      path: string;
      externalTarget?: string;
      externalPathTarget?: string;
    };

type MutableDirectory = {
  kind: 'directory';
  name: string;
  path: string;
  children: Map<string, MutableNode>;
};

type MutableNode = MutableDirectory | Extract<FileTreeNode, { kind: 'file' }>;

const finderCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function sortedChildren(
  children: Map<string, MutableNode>,
  indexPath: string | null,
  directoryOrder: ViewIndex['directoryOrder'],
  directory = '',
): FileTreeNode[] {
  const ranks = new Map<string, number>();
  const entries = Object.hasOwn(directoryOrder, directory)
    ? directoryOrder[directory]
    : [];
  for (const [rank, name] of entries.entries()) {
    if (!ranks.has(name)) ranks.set(name, rank);
  }
  const rank = (node: MutableNode): number =>
    Math.min(
      ranks.get(node.name) ?? Infinity,
      node.kind === 'file'
        ? (ranks.get(node.name.replace(/\.md$/i, '')) ?? Infinity)
        : Infinity,
    );
  return [...children.values()]
    .sort((a, b) => {
      if (indexPath) {
        const aIsIndex = a.kind === 'file' && a.path === indexPath;
        const bIsIndex = b.kind === 'file' && b.path === indexPath;
        if (aIsIndex !== bIsIndex) return aIsIndex ? -1 : 1;
      }
      const aRank = rank(a);
      const bRank = rank(b);
      if (aRank !== bRank) return aRank - bRank;
      return (
        finderCollator.compare(a.name, b.name) || a.name.localeCompare(b.name)
      );
    })
    .map((node) =>
      node.kind === 'directory'
        ? {
            ...node,
            children: sortedChildren(
              node.children,
              `${node.path}/${node.name}.md`,
              directoryOrder,
              node.path,
            ),
          }
        : node,
    );
}

/** Return the conventional name/name.md index for a directory, when present. */
export function directoryIndex(
  directory: Extract<FileTreeNode, { kind: 'directory' }>,
): Extract<FileTreeNode, { kind: 'file' }> | null {
  const indexPath = `${directory.path}/${directory.name}.md`;
  return (
    directory.children.find(
      (child): child is Extract<FileTreeNode, { kind: 'file' }> =>
        child.kind === 'file' && child.path === indexPath,
    ) ?? null
  );
}

/** Ensure an indexed directory is visibly expanded before navigating into it. */
export function expandDirectory(directory: { open: boolean } | null): void {
  if (directory) directory.open = true;
}

/** Sum validation errors below a file or directory for propagated markers. */
export function fileTreeErrorCount(
  node: FileTreeNode,
  errorCounts: Readonly<Record<string, number>>,
): number {
  if (node.kind === 'file') return errorCounts[node.path] ?? 0;
  return node.children.reduce(
    (count, child) => count + fileTreeErrorCount(child, errorCounts),
    0,
  );
}

/** Collapse descendant Git state into one directory marker. */
export function fileTreeGitStatus(
  node: FileTreeNode,
  gitFiles: Readonly<Record<string, ViewGitFileStatus>>,
): ViewGitFileStatus | null {
  if (node.kind === 'file') return gitFiles[node.path] ?? null;
  let status: ViewGitFileStatus | null = null;
  for (const child of node.children) {
    const childStatus = fileTreeGitStatus(child, gitFiles);
    if (childStatus === 'modified') return 'modified';
    if (childStatus === 'new') status = 'new';
  }
  return status;
}

function buildTree(
  files: Array<{
    path: string;
    externalTarget?: string;
    externalPathTarget?: string;
  }>,
  directoryOrder: ViewIndex['directoryOrder'] = {},
  entry = 'lat.md',
): FileTreeNode[] {
  const root = new Map<string, MutableNode>();

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let children = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const name = parts[index];
      const path = parts.slice(0, index + 1).join('/');
      const existing = children.get(name);
      if (existing?.kind === 'file') break;

      const directory: MutableDirectory = existing ?? {
        kind: 'directory',
        name,
        path,
        children: new Map(),
      };
      children.set(name, directory);
      children = directory.children;
    }

    const name = parts[parts.length - 1];
    children.set(name, {
      kind: 'file',
      name,
      path: file.path,
      ...(file.externalTarget ? { externalTarget: file.externalTarget } : {}),
      ...(file.externalPathTarget
        ? { externalPathTarget: file.externalPathTarget }
        : {}),
    });
  }

  return sortedChildren(root, entry, directoryOrder);
}

/** Convert vault-relative file paths into the hierarchy shown in the sidebar. */
export function buildFileTree(
  files: string[],
  directoryOrder: ViewIndex['directoryOrder'] = {},
  entry = 'lat.md',
): FileTreeNode[] {
  return buildTree(
    files.map((path) => ({ path })),
    directoryOrder,
    entry,
  );
}

/** Group referenced external files into source-handle roots for the sidebar. */
export function buildExternalFileTree(
  files: ViewExternalFile[],
): FileTreeNode[] {
  if (files.length === 0) return [];
  const [root] = buildTree(
    files.map((file) => ({
      path: `@external/${file.handle}/${file.path}`,
      externalTarget: file.target,
      externalPathTarget: `${file.handle}:${file.path}`,
    })),
  );
  return root?.kind === 'directory' ? root.children : [];
}
