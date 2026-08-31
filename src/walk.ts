import type { EventEmitter } from 'node:events';
// @ts-expect-error -- no type declarations
import walk from 'ignore-walk';

type IgnoreWalkerInstance = EventEmitter & {
  filterEntry(
    entry: string,
    partial?: boolean,
    entryBasename?: string,
  ): boolean;
  walkerOpt(
    entry: string,
    options: Record<string, unknown>,
  ): Record<string, unknown>;
  start(): IgnoreWalkerInstance;
};

type IgnoreWalkerConstructor = new (
  options: Record<string, unknown>,
) => IgnoreWalkerInstance;

const IgnoreWalker = (walk as unknown as { Walker: IgnoreWalkerConstructor })
  .Walker;

class DotIgnoringWalker extends IgnoreWalker {
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

  walker(
    entry: string,
    options: Record<string, unknown>,
    done: () => void,
  ): void {
    new DotIgnoringWalker(this.walkerOpt(entry, options))
      .on('done', done)
      .start();
  }
}

/**
 * Walk a directory tree respecting .gitignore rules. Returns relative paths
 * of all non-ignored files, excluding .git/ and dotfiles (e.g. .gitignore).
 *
 * This is the single entry point for all directory walking in lat.md — both
 * code-ref scanning and lat.md/ index validation use it so .gitignore rules
 * are consistently honored.
 */
export function walkEntries(dir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    new DotIgnoringWalker({
      path: dir,
      ignoreFiles: ['.gitignore'],
    })
      .on('done', resolve)
      .on('error', reject)
      .start();
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
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}
