import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  buildExternalFileTree,
  buildFileTree,
  directoryIndex,
  expandDirectory,
  fileTreeErrorCount,
  fileTreeGitStatus,
  readOpenDirectories,
  type FileTreeNode,
  writeOpenDirectories,
} from './file-tree';
import type {
  ViewExternalFile,
  ViewGitFileStatus,
} from '../../src/view/protocol';
import { documentUrl, externalUrl } from './navigation';

type FileTreeProps = {
  activePath: string | null;
  activeExternalTarget: string | null;
  errorCounts: Record<string, number>;
  externalFiles: ViewExternalFile[];
  files: string[];
  gitFiles: Record<string, ViewGitFileStatus>;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  storageKey: string;
};

function isActiveFile(
  node: Extract<FileTreeNode, { kind: 'file' }>,
  activePath: string | null,
  activeExternalTarget: string | null,
): boolean {
  if (!node.externalTarget) return node.path === activePath;
  const baseTarget = activeExternalTarget?.split('#', 1)[0] ?? null;
  return (
    baseTarget === node.externalTarget || baseTarget === node.externalPathTarget
  );
}

function containsActiveFile(
  node: FileTreeNode,
  activePath: string | null,
  activeExternalTarget: string | null,
): boolean {
  if (node.kind === 'file') {
    return isActiveFile(node, activePath, activeExternalTarget);
  }
  return node.children.some((child) =>
    containsActiveFile(child, activePath, activeExternalTarget),
  );
}

function fileUrl(node: Extract<FileTreeNode, { kind: 'file' }>): string {
  return node.externalTarget
    ? externalUrl(node.externalTarget)
    : documentUrl(node.path);
}

function TreeNode({
  activePath,
  activeExternalTarget,
  errorCounts,
  gitFiles,
  node,
  onDirectoryToggle,
  onNavigate,
  openDirectories,
}: {
  activePath: string | null;
  activeExternalTarget: string | null;
  errorCounts: FileTreeProps['errorCounts'];
  gitFiles: FileTreeProps['gitFiles'];
  node: FileTreeNode;
  onDirectoryToggle: (path: string, open: boolean) => void;
  onNavigate: FileTreeProps['onNavigate'];
  openDirectories: ReadonlySet<string>;
}) {
  if (node.kind === 'directory') {
    const index = directoryIndex(node);
    const errorCount = fileTreeErrorCount(node, errorCounts);
    const gitStatus = fileTreeGitStatus(node, gitFiles);
    return (
      <details
        className="tree-directory"
        open={
          openDirectories.has(node.path) ||
          containsActiveFile(node, activePath, activeExternalTarget) ||
          undefined
        }
        onToggle={(event) =>
          onDirectoryToggle(node.path, event.currentTarget.open)
        }
      >
        <summary>
          {index ? (
            <a
              href={fileUrl(index)}
              onClick={(event) => {
                expandDirectory(event.currentTarget.closest('details'));
                onDirectoryToggle(node.path, true);
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
              activeExternalTarget={activeExternalTarget}
              errorCounts={errorCounts}
              gitFiles={gitFiles}
              key={child.path}
              node={child}
              onDirectoryToggle={onDirectoryToggle}
              onNavigate={onNavigate}
              openDirectories={openDirectories}
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
        isActiveFile(node, activePath, activeExternalTarget)
          ? 'document-link active'
          : 'document-link'
      }
      href={fileUrl(node)}
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
  activeExternalTarget,
  errorCounts,
  externalFiles,
  files,
  gitFiles,
  onNavigate,
  storageKey,
}: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const externalTree = useMemo(
    () => buildExternalFileTree(externalFiles),
    [externalFiles],
  );
  const [openDirectories, setOpenDirectories] = useState<Set<string>>(() => {
    try {
      return readOpenDirectories(window.localStorage, storageKey);
    } catch {
      return new Set();
    }
  });
  const activeDirectories = useMemo(() => {
    const paths = new Set<string>();
    const collect = (nodes: FileTreeNode[]): void => {
      for (const node of nodes) {
        if (
          node.kind === 'directory' &&
          containsActiveFile(node, activePath, activeExternalTarget)
        ) {
          paths.add(node.path);
          collect(node.children);
        }
      }
    };
    collect(tree);
    collect(externalTree);
    return paths;
  }, [activeExternalTarget, activePath, externalTree, tree]);

  useEffect(() => {
    if ([...activeDirectories].every((path) => openDirectories.has(path))) {
      return;
    }
    setOpenDirectories((current) => {
      const next = new Set(current);
      for (const path of activeDirectories) next.add(path);
      return next;
    });
  }, [activeDirectories, openDirectories]);

  useEffect(() => {
    try {
      writeOpenDirectories(window.localStorage, storageKey, openDirectories);
    } catch {
      // Storage can be unavailable; expansion still lasts for this page load.
    }
  }, [openDirectories, storageKey]);

  const onDirectoryToggle = (path: string, open: boolean): void => {
    setOpenDirectories((current) => {
      if (current.has(path) === open) return current;
      const next = new Set(current);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  return (
    <div className="file-tree">
      {tree.map((node) => (
        <TreeNode
          activePath={activePath}
          activeExternalTarget={activeExternalTarget}
          errorCounts={errorCounts}
          gitFiles={gitFiles}
          key={node.path}
          node={node}
          onDirectoryToggle={onDirectoryToggle}
          onNavigate={onNavigate}
          openDirectories={openDirectories}
        />
      ))}
      {externalTree.length > 0 && (
        <div className="file-tree-section-label">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.1 3.4 8.5s-1.2 6.2-3.4 8.5M12 3.5C9.8 5.8 8.6 8.6 8.6 12s1.2 6.2 3.4 8.5" />
          </svg>
          <span>External sources</span>
        </div>
      )}
      {externalTree.map((node) => (
        <TreeNode
          activePath={activePath}
          activeExternalTarget={activeExternalTarget}
          errorCounts={errorCounts}
          gitFiles={gitFiles}
          key={node.path}
          node={node}
          onDirectoryToggle={onDirectoryToggle}
          onNavigate={onNavigate}
          openDirectories={openDirectories}
        />
      ))}
    </div>
  );
}
