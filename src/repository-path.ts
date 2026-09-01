import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { toPosix } from './path.js';

export type RepositoryPathKind = 'directory' | 'file' | 'other';

export type RepositoryPathInspection =
  | { kind: RepositoryPathKind; realPath: string }
  | { kind: 'missing' | 'outside' };

/** Normalize a portable project-root-relative path without allowing escapes. */
export function normalizeRepositoryPath(authoredPath: string): string | null {
  if (!authoredPath || authoredPath.includes('\0')) return null;
  const portable = toPosix(authoredPath);
  if (posix.isAbsolute(portable) || /^[a-z]:\//i.test(portable)) return null;

  const normalized = posix.normalize(portable).replace(/^\.\//, '');
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('\0')
  ) {
    return null;
  }
  return normalized;
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  );
}

/** Inspect an existing path after resolving symlinks beneath the project root. */
export async function inspectRepositoryPath(
  projectRoot: string,
  path: string,
): Promise<RepositoryPathInspection> {
  const candidate = resolve(projectRoot, ...path.split('/'));
  let realRoot: string;
  let realPath: string;
  try {
    [realRoot, realPath] = await Promise.all([
      realpath(projectRoot),
      realpath(candidate),
    ]);
  } catch {
    return { kind: 'missing' };
  }
  if (!isInside(realRoot, realPath)) return { kind: 'outside' };

  try {
    const info = await stat(realPath);
    const kind: RepositoryPathKind = info.isFile()
      ? 'file'
      : info.isDirectory()
        ? 'directory'
        : 'other';
    return { kind, realPath };
  } catch {
    return { kind: 'missing' };
  }
}
