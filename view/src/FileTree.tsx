import { useMemo, type MouseEvent } from 'react';
import {
  buildFileTree,
  directoryIndex,
  expandDirectory,
  fileTreeErrorCount,
  fileTreeGitStatus,
  type FileTreeNode,
} from './file-tree';
import type { ViewGitFileStatus } from '../../src/view/protocol';
import { documentUrl } from './navigation';

type FileTreeProps = {
  activePath: string | null;
  errorCounts: Record<string, number>;
  files: string[];
  gitFiles: Record<string, ViewGitFileStatus>;
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
  gitFiles,
  node,
  onNavigate,
}: {
  activePath: string | null;
  errorCounts: FileTreeProps['errorCounts'];
  gitFiles: FileTreeProps['gitFiles'];
  node: FileTreeNode;
  onNavigate: FileTreeProps['onNavigate'];
}) {
  if (node.kind === 'directory') {
    const index = directoryIndex(node);
    const errorCount = fileTreeErrorCount(node, errorCounts);
    const gitStatus = fileTreeGitStatus(node, gitFiles);
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
              {(errorCount > 0 || gitStatus) && (
                <FileStateDisc errorCount={errorCount} gitStatus={gitStatus} />
              )}
            </a>
          ) : (
            <span>
              <span className="document-link-name">{node.name}</span>
              {(errorCount > 0 || gitStatus) && (
                <FileStateDisc errorCount={errorCount} gitStatus={gitStatus} />
              )}
            </span>
          )}
        </summary>
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              activePath={activePath}
              errorCounts={errorCounts}
              gitFiles={gitFiles}
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
  const gitStatus = fileTreeGitStatus(node, gitFiles);

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
      {(errorCount > 0 || gitStatus) && (
        <FileStateDisc errorCount={errorCount} gitStatus={gitStatus} />
      )}
    </a>
  );
}

function FileStateDisc({
  errorCount,
  gitStatus,
}: {
  errorCount: number;
  gitStatus: ViewGitFileStatus | null;
}) {
  const labels = [
    errorCount > 0
      ? `${errorCount} validation ${errorCount === 1 ? 'error' : 'errors'}`
      : '',
    gitStatus ? `${gitStatus} in Git` : '',
  ].filter(Boolean);
  const label = labels.join('; ');
  return (
    <span
      aria-label={label}
      className={`document-state-disc${errorCount > 0 ? ' has-errors' : ''}${gitStatus ? ` git-${gitStatus}` : ''}`}
      role="img"
      title={label}
    />
  );
}

export function FileTree({
  activePath,
  errorCounts,
  files,
  gitFiles,
  onNavigate,
}: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  return (
    <div className="file-tree" key={activePath}>
      {tree.map((node) => (
        <TreeNode
          activePath={activePath}
          errorCounts={errorCounts}
          gitFiles={gitFiles}
          key={node.path}
          node={node}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
