import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { toPosix } from '../walk.js';
import type { ViewGitFileStatus } from './protocol.js';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_GIT_OUTPUT = 50 * 1024 * 1024;

export type ViewGitFileSnapshot = {
  status: ViewGitFileStatus;
  baseContent: string;
};

export type ViewGitSnapshot = {
  available: boolean;
  files: ReadonlyMap<string, ViewGitFileSnapshot>;
};

export type ViewGitRepository = {
  root: string;
  latRelative: string;
};

export type ViewGitRunner = (cwd: string, args: string[]) => Promise<string>;

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  );
}

/** Find the Git worktree containing the active lat.md directory. */
export async function findViewGitRepository(
  projectRoot: string,
  latDir: string,
  runner: ViewGitRunner = runGit,
): Promise<ViewGitRepository | null> {
  try {
    const output = await runner(projectRoot, [
      'rev-parse',
      '--show-toplevel',
      '--is-inside-work-tree',
    ]);
    const lines = output.trim().split('\n');
    const reportedRoot = lines[0]?.trim();
    if (!reportedRoot || lines.at(-1)?.trim() !== 'true') {
      return null;
    }
    const [root, realLatDir] = await Promise.all([
      realpath(reportedRoot),
      realpath(latDir),
    ]);
    if (!inside(root, realLatDir)) return null;
    return {
      root,
      latRelative: toPosix(relative(root, realLatDir)),
    };
  } catch {
    return null;
  }
}

function vaultPath(repository: ViewGitRepository, path: string): string | null {
  const normalized = toPosix(path);
  if (!repository.latRelative) return normalized;
  const prefix = `${repository.latRelative}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

function statusFiles(
  repository: ViewGitRepository,
  output: string,
): Map<string, ViewGitFileStatus> {
  const files = new Map<string, ViewGitFileStatus>();
  const entries = output.split('\0');
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = vaultPath(repository, entry.slice(3));
    if (path) {
      files.set(
        path,
        status.includes('?') || status.includes('A') ? 'new' : 'modified',
      );
    }
    if (status.includes('R') || status.includes('C')) index++;
  }
  return files;
}

function patchPath(line: string): string | null {
  const path = line.slice(4);
  if (path === '/dev/null') return null;
  return path.startsWith('b/') ? path.slice(2) : path;
}

/** Reconstruct each tracked file's HEAD content from one full-context diff. */
function baseContentsFromPatch(output: string): Map<string, string> {
  const contents = new Map<string, string>();
  let path: string | null = null;
  let oldLines: string[] = [];
  let inHunk = false;
  let sawFile = false;
  let oldEndsWithNewline = true;
  let previousWasOldLine = false;

  const finish = () => {
    if (path && sawFile) {
      contents.set(
        path,
        `${oldLines.join('\n')}${oldLines.length > 0 && oldEndsWithNewline ? '\n' : ''}`,
      );
    }
    path = null;
    oldLines = [];
    inHunk = false;
    sawFile = false;
    oldEndsWithNewline = true;
    previousWasOldLine = false;
  };

  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) {
      finish();
      sawFile = true;
      continue;
    }
    if (sawFile && line.startsWith('+++ ')) {
      path = patchPath(line);
      continue;
    }
    if (sawFile && line.startsWith('@@ ')) {
      inHunk = true;
      previousWasOldLine = false;
      continue;
    }
    if (!inHunk) continue;
    if (line === '\\ No newline at end of file') {
      if (previousWasOldLine) oldEndsWithNewline = false;
      continue;
    }
    const marker = line[0];
    previousWasOldLine = marker === ' ' || marker === '-';
    if (previousWasOldLine) oldLines.push(line.slice(1));
  }
  finish();
  return contents;
}

async function hasHead(
  repository: ViewGitRepository,
  runner: ViewGitRunner,
): Promise<boolean> {
  try {
    await runner(repository.root, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/** Read the cached HEAD-to-working-tree state for visible lat.md files. */
export async function readViewGitSnapshot(
  repository: ViewGitRepository,
  currentFiles: ReadonlyMap<string, { content: string }>,
  runner: ViewGitRunner = runGit,
): Promise<ViewGitSnapshot> {
  const baseline = (await hasHead(repository, runner)) ? 'HEAD' : EMPTY_TREE;
  const pathspec = repository.latRelative || '.';
  const relative = repository.latRelative
    ? [`--relative=${repository.latRelative}`]
    : [];
  const [statusOutput, patchOutput] = await Promise.all([
    runner(repository.root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      pathspec,
    ]),
    runner(repository.root, [
      '-c',
      'core.quotePath=false',
      'diff',
      '--no-ext-diff',
      '--no-color',
      '--unified=1000000',
      ...relative,
      baseline,
      '--',
      pathspec,
    ]),
  ]);
  const statuses = statusFiles(repository, statusOutput);
  const baseContents = baseContentsFromPatch(patchOutput);
  const files = new Map<string, ViewGitFileSnapshot>();

  for (const [path, status] of statuses) {
    const current = currentFiles.get(path);
    if (!current) continue;
    files.set(path, {
      status,
      baseContent:
        status === 'new' ? '' : (baseContents.get(path) ?? current.content),
    });
  }

  return { available: true, files };
}

export function emptyViewGitSnapshot(): ViewGitSnapshot {
  return { available: false, files: new Map() };
}

export function sameViewGitSnapshot(
  left: ViewGitSnapshot,
  right: ViewGitSnapshot,
): boolean {
  if (
    left.available !== right.available ||
    left.files.size !== right.files.size
  )
    return false;
  for (const [path, file] of left.files) {
    const candidate = right.files.get(path);
    if (
      !candidate ||
      candidate.status !== file.status ||
      candidate.baseContent !== file.baseContent
    ) {
      return false;
    }
  }
  return true;
}
