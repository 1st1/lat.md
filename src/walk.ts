// @ts-expect-error -- no type declarations
import walk from 'ignore-walk';

/**
 * Walk a directory tree respecting .gitignore rules. Returns relative paths
 * of all non-ignored files, excluding .git/ and dotfiles (e.g. .gitignore).
 *
 * This is the single entry point for all directory walking in lat.md — both
 * code-ref scanning and lat.md/ index validation use it so .gitignore rules
 * are consistently honored.
 */
export function walkEntries(dir: string): Promise<string[]> {
  return walk({
    path: dir,
    ignoreFiles: ['.gitignore'],
  }).then((entries: string[]) =>
    entries.filter((e: string) => !e.startsWith('.git/') && !e.startsWith('.')),
  );
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
