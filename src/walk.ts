import { readdir, readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- no type declarations
import walk from 'ignore-walk';

type IgnoreWalkerOptions = {
  path: string;
  parent?: IgnoreWalkerInstance;
  ignoreFiles: string[];
  exact?: boolean;
};

type IgnoreWalkerInstance = {
  filterEntry(
    entry: string,
    partial?: boolean,
    entryBasename?: string,
  ): boolean;
  onReadIgnoreFile(file: string, data: string, done: () => void): void;
};

type IgnoreWalkerConstructor = new (
  options: IgnoreWalkerOptions,
) => IgnoreWalkerInstance;

const IgnoreWalker = (walk as unknown as { Walker: IgnoreWalkerConstructor })
  .Walker;

class IgnoreContext extends IgnoreWalker {
  filterEntry(
    entry: string,
    partial?: boolean,
    entryBasename?: string,
  ): boolean {
    const candidate = entryBasename ?? entry;
    if (
      candidate
        .split(/[\\/]/)
        .some(
          (part) =>
            part.startsWith('.') &&
            part !== '.' &&
            part !== '..' &&
            part !== '.lat-ui-build',
        )
    ) {
      return false;
    }
    return super.filterEntry(entry, partial, entryBasename);
  }
}

type DirectoryJob = {
  path: string;
  relativePath: string;
  ignoreContext: IgnoreWalkerInstance;
};

type DirectoryResult = {
  directories: DirectoryJob[];
  files: string[];
};

async function readDirectory(job: DirectoryJob): Promise<DirectoryResult> {
  const entries = await readdir(job.path, { withFileTypes: true });
  if (entries.some((entry) => entry.name === '.gitignore')) {
    const rules = await readFile(join(job.path, '.gitignore'), 'utf8');
    job.ignoreContext.onReadIgnoreFile('.gitignore', rules, () => {});
  }

  const directories: DirectoryJob[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const passDirectory = job.ignoreContext.filterEntry(entry.name, true);
      if (!passDirectory) continue;
      const passFile = job.ignoreContext.filterEntry(entry.name);
      const path = join(job.path, entry.name);
      directories.push({
        path,
        relativePath: job.relativePath
          ? `${job.relativePath}/${entry.name}`
          : entry.name,
        ignoreContext: new IgnoreContext({
          path,
          parent: job.ignoreContext,
          ignoreFiles: ['.gitignore'],
          exact: passFile || job.ignoreContext.filterEntry(`${entry.name}/`),
        }),
      });
    } else if (job.ignoreContext.filterEntry(entry.name)) {
      files.push(
        job.relativePath ? `${job.relativePath}/${entry.name}` : entry.name,
      );
    }
  }

  return { directories, files };
}

async function walkWithDirectoryPool(root: DirectoryJob): Promise<string[]> {
  const queue = [root];
  const files: string[] = [];
  const workerLimit = availableParallelism();
  let nextJob = 0;
  let activeWorkers = 0;

  return new Promise((resolve, reject) => {
    let settled = false;

    const schedule = (): void => {
      if (settled) return;

      while (activeWorkers < workerLimit && nextJob < queue.length) {
        const job = queue[nextJob++];
        activeWorkers++;
        void readDirectory(job).then(
          (result) => {
            files.push(...result.files);
            queue.push(...result.directories);
            activeWorkers--;

            if (activeWorkers === 0 && nextJob === queue.length) {
              settled = true;
              files.sort((a, b) => a.localeCompare(b, 'en'));
              resolve(files);
            } else {
              schedule();
            }
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error);
          },
        );
      }
    };

    schedule();
  });
}

/**
 * Walk a directory tree respecting nested .gitignore rules. Directories are
 * consumed through a bounded queue, and each completed job submits its visible
 * children back to the pool. Returns sorted project-relative POSIX paths.
 *
 * This is the single entry point for all directory walking in lat.md — both
 * code-ref scanning and lat.md/ index validation use it so .gitignore rules
 * are consistently honored.
 */
export function walkEntries(dir: string): Promise<string[]> {
  return walkWithDirectoryPool({
    path: dir,
    relativePath: '',
    ignoreContext: new IgnoreContext({
      path: dir,
      ignoreFiles: ['.gitignore'],
    }),
  });
}

/**
 * Normalize a filesystem path to forward-slash (POSIX) form. Node's
 * `path.relative()` emits the native separator (`\` on Windows), but section
 * ids, wiki-link targets, and the code-ref data model are all forward-slash
 * based. Normalizing every OS-relative path through here at construction keeps
 * a single invariant — stored paths are always POSIX — so downstream lookups
 * (e.g. `buildFileIndex`, ref resolution) work identically on every platform.
 */
