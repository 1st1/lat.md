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
    };

type MutableDirectory = {
  kind: 'directory';
  name: string;
  path: string;
  children: Map<string, MutableNode>;
};

type MutableNode = MutableDirectory | Extract<FileTreeNode, { kind: 'file' }>;

function sortedChildren(children: Map<string, MutableNode>): FileTreeNode[] {
  return [...children.values()]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((node) =>
      node.kind === 'directory'
        ? { ...node, children: sortedChildren(node.children) }
        : node,
    );
}

/** Convert vault-relative file paths into the hierarchy shown in the sidebar. */
export function buildFileTree(files: string[]): FileTreeNode[] {
  const root = new Map<string, MutableNode>();

  for (const file of files) {
    const parts = file.split('/').filter(Boolean);
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
    children.set(name, { kind: 'file', name, path: file });
  }

  return sortedChildren(root);
}
