import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  findLatticeDir,
  listLatticeFiles,
  parseSections,
  buildFileIndex,
  resolveRef,
} from '../src/lattice.js';
import { toPosix } from '../src/walk.js';

const basicDir = join(import.meta.dirname, 'cases', 'basic-project');
const basicLat = join(basicDir, 'lat.md');

describe('findLatticeDir', () => {
  it('finds .lat in the given directory', () => {
    expect(findLatticeDir(basicDir)).toBe(basicLat);
  });

  it('returns null when no .lat exists', () => {
    expect(findLatticeDir('/')).toBeNull();
  });
});

describe('listLatticeFiles', () => {
  it('lists .md files sorted alphabetically', async () => {
    const files = await listLatticeFiles(basicLat);
    expect(files).toEqual([
      join(basicLat, 'dev-process.md'),
      join(basicLat, 'notes.md'),
    ]);
  });
});

describe('parseSections', () => {
  it('handles multiple top-level headings', () => {
    const sections = parseSections('multi.md', '# First\n\n# Second\n');
    expect(sections).toHaveLength(2);
    expect(sections[0].id).toBe('multi#First');
    expect(sections[1].id).toBe('multi#Second');
  });

  it('uses file stem without .md extension', () => {
    const sections = parseSections('/path/to/notes.md', '# Hello');
    expect(sections[0].file).toBe('notes');
  });
});

describe('toPosix', () => {
  it('converts native backslash separators to forward slashes', () => {
    expect(toPosix('codigo\\codigo.md')).toBe('codigo/codigo.md');
    expect(toPosix('lat.md\\codigo\\a')).toBe('lat.md/codigo/a');
  });

  it('leaves POSIX paths unchanged', () => {
    expect(toPosix('lat.md/codigo/a')).toBe('lat.md/codigo/a');
    expect(toPosix('notes')).toBe('notes');
    expect(toPosix('')).toBe('');
  });
});

// Regression guard for issue #69: on Windows, section file paths kept the
// native `\` separator, so bare-name (`[[a]]`) links in a directory-index file
// never resolved. Section paths are now normalized to POSIX at construction, so
// this scenario resolves identically on every OS. The windows-latest CI job
// runs this same test on the platform where the bug originally manifested.
describe('bare-name link resolution in a subdirectory (issue #69)', () => {
  const root = join('/tmp', 'proj');
  const parse = (rel: string, body: string) =>
    parseSections(join(root, 'lat.md', rel), body, root);

  it('resolves short-form links to sibling files in the same subdir', () => {
    const sections = [
      ...parse('codigo/a.md', '# A\n\nAlpha.\n'),
      ...parse('codigo/b.md', '# B\n\nBravo.\n'),
      ...parse('codigo/codigo.md', '# Codigo\n\nDirectory index.\n'),
    ];

    // The invariant the fix enforces: stored paths are POSIX on every platform.
    expect(sections.map((s) => s.file)).toContain('lat.md/codigo/a');
    expect(sections.every((s) => !s.file.includes('\\'))).toBe(true);

    const fileIndex = buildFileIndex(sections);
    const sectionIds = new Set(sections.map((s) => s.id.toLowerCase()));

    for (const name of ['a', 'b']) {
      const { resolved, ambiguous } = resolveRef(name, sectionIds, fileIndex);
      expect(ambiguous).toBeNull();
      expect(sectionIds.has(resolved.toLowerCase())).toBe(true);
    }
  });
});
