import { useMemo, type MouseEvent } from 'react';
import { buildFileTree, type FileTreeNode } from './file-tree';
import { documentUrl } from './navigation';

type FileTreeProps = {
  activePath: string | null;
  files: string[];
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
};

function containsPath(node: FileTreeNode, path: string | null): boolean {
  if (!path) return false;
  if (node.kind === 'file') return node.path === path;
  return node.children.some((child) => containsPath(child, path));
}

function TreeNode({
  activePath,
  node,
  onNavigate,
}: {
  activePath: string | null;
  node: FileTreeNode;
  onNavigate: FileTreeProps['onNavigate'];
}) {
  if (node.kind === 'directory') {
    return (
      <details
        className="tree-directory"
        open={containsPath(node, activePath) || undefined}
      >
        <summary>{node.name}</summary>
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              activePath={activePath}
              key={child.path}
              node={child}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </details>
    );
  }

  return (
    <a
      className={
        node.path === activePath ? 'document-link active' : 'document-link'
      }
      href={documentUrl(node.path)}
      onClick={onNavigate}
    >
      {node.name.replace(/\.md$/i, '')}
    </a>
  );
}

export function FileTree({ activePath, files, onNavigate }: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  return (
    <div className="file-tree" key={activePath}>
      {tree.map((node) => (
        <TreeNode
          activePath={activePath}
          key={node.path}
          node={node}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
