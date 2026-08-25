import { useMemo, type MouseEvent } from 'react';
import {
  buildFileTree,
  directoryIndex,
  expandDirectory,
  fileTreeErrorCount,
  type FileTreeNode,
} from './file-tree';
import { documentUrl } from './navigation';

type FileTreeProps = {
  activePath: string | null;
  errorCounts: Record<string, number>;
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
  errorCounts,
  node,
  onNavigate,
}: {
  activePath: string | null;
  errorCounts: FileTreeProps['errorCounts'];
  node: FileTreeNode;
  onNavigate: FileTreeProps['onNavigate'];
}) {
  if (node.kind === 'directory') {
    const index = directoryIndex(node);
    const errorCount = fileTreeErrorCount(node, errorCounts);
    return (
      <details
        className="tree-directory"
        open={containsPath(node, activePath) || undefined}
      >
        <summary>
          {index ? (
            <a
              href={documentUrl(index.path)}
              onClick={(event) => {
                expandDirectory(event.currentTarget.closest('details'));
                onNavigate(event);
              }}
            >
              <span className="document-link-name">{node.name}</span>
              {errorCount > 0 && <FileErrorDisc count={errorCount} />}
            </a>
          ) : (
            <span>
              <span className="document-link-name">{node.name}</span>
              {errorCount > 0 && <FileErrorDisc count={errorCount} />}
            </span>
          )}
        </summary>
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              activePath={activePath}
              errorCounts={errorCounts}
              key={child.path}
              node={child}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </details>
    );
  }

  const errorCount = fileTreeErrorCount(node, errorCounts);

  return (
    <a
      className={
        node.path === activePath ? 'document-link active' : 'document-link'
      }
      href={documentUrl(node.path)}
      onClick={onNavigate}
    >
      <span className="document-link-name">
        {node.name.replace(/\.md$/i, '')}
      </span>
      {errorCount > 0 && <FileErrorDisc count={errorCount} />}
    </a>
  );
}

function FileErrorDisc({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} validation ${count === 1 ? 'error' : 'errors'}`}
      className="document-error-disc"
      role="img"
      title={`${count} validation ${count === 1 ? 'error' : 'errors'}`}
    />
  );
}

export function FileTree({
  activePath,
  errorCounts,
  files,
  onNavigate,
}: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  return (
    <div className="file-tree" key={activePath}>
      {tree.map((node) => (
        <TreeNode
          activePath={activePath}
          errorCounts={errorCounts}
          key={node.path}
          node={node}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
