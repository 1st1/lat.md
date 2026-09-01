import type {
  ViewExternalFile,
  ViewGitFileStatus,
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

type FileTreeStorage = {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
};

const finderCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function sortedChildren(
  children: Map<string, MutableNode>,
  indexPath: string | null,
): FileTreeNode[] {
  return [...children.values()]
    .sort((a, b) => {
      if (indexPath) {
        const aIsIndex = a.kind === 'file' && a.path === indexPath;
        const bIsIndex = b.kind === 'file' && b.path === indexPath;
        if (aIsIndex !== bIsIndex) return aIsIndex ? -1 : 1;
      }
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

/** Scope persisted sidebar expansion to one live or static deployment. */
export function fileTreeStorageKey(basePath: string | null): string {
  return `lat.ui.open-directories:${basePath ?? '/'}`;
}

/** Read the valid directory paths saved by a previous browser session. */
export function readOpenDirectories(
  storage: FileTreeStorage,
  key: string,
): Set<string> {
  const value = storage.getItem(key);
  if (!value) return new Set();
  try {
    const paths: unknown = JSON.parse(value);
    if (!Array.isArray(paths)) return new Set();
    return new Set(
      paths.filter((path): path is string => typeof path === 'string'),
    );
  } catch {
    return new Set();
  }
}

/** Persist expanded directory paths, removing empty state from storage. */
export function writeOpenDirectories(
  storage: FileTreeStorage,
  key: string,
  paths: ReadonlySet<string>,
): void {
  if (paths.size === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify([...paths].sort()));
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

  return sortedChildren(root, 'lat.md');
}

/** Convert vault-relative file paths into the hierarchy shown in the sidebar. */
export function buildFileTree(files: string[]): FileTreeNode[] {
  return buildTree(files.map((path) => ({ path })));
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
