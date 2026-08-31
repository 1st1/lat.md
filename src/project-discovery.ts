import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Find the nearest ancestor containing the project's lat.md directory. */
export function findLatticeDir(from?: string): string | null {
  let dir = resolve(from ?? process.cwd());
  while (true) {
    const candidate = join(dir, 'lat.md');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Find the root of the nearest project containing a lat.md directory. */
export function findProjectRoot(from?: string): string | null {
  const latDir = findLatticeDir(from);
  return latDir ? dirname(latDir) : null;
}

/** List project Markdown files without loading the Markdown parser. */
export async function listLatticeFiles(latticeDir: string): Promise<string[]> {
  const { walkEntries } = await import('./walk.js');
  const entries = await walkEntries(latticeDir);
  return entries
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => join(latticeDir, entry));
}
