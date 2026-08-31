import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasRipgrep, scanCodeRefs, type ScanResult } from '../src/code-refs.js';
import {
  isSourceFilePath,
  SOURCE_FILE_EXTENSIONS,
} from '../src/source-formats.js';

const roots: string[] = [];

function codeReference(comment: string, target: string): string {
  return `${comment} @${'lat'}: [[${target}]]\n`;
}

async function createSourceProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lat-code-refs-'));
  const sourceDir = join(root, 'src');
  await mkdir(sourceDir);
  roots.push(root);

  await Promise.all([
    ...SOURCE_FILE_EXTENSIONS.map((extension) => {
      const comment = extension === '.py' ? '#' : '//';
      return writeFile(
        join(sourceDir, `source${extension}`),
        codeReference(comment, `Specs#${extension.slice(1)}`),
      );
    }),
    writeFile(
      join(sourceDir, 'unsupported.txt'),
      codeReference('//', 'Specs#unsupported'),
    ),
  ]);
  return root;
}

function expectRegisteredSourcesOnly(scan: ScanResult): void {
  expect(scan.refs.map((ref) => ref.file).sort()).toEqual(
    SOURCE_FILE_EXTENSIONS.map((extension) => `src/source${extension}`).sort(),
  );
  expect(scan.refs.some((ref) => ref.target === 'Specs#unsupported')).toBe(
    false,
  );
  expect(scan.files.some((file) => file.endsWith('unsupported.txt'))).toBe(
    true,
  );
}

function relativeFiles(root: string, scan: ScanResult): string[] {
  return scan.files.map((file) => relative(root, file).replaceAll('\\', '/'));
}

function comparableRefs(scan: ScanResult): string[] {
  return scan.refs.map((ref) => `${ref.file}:${ref.line}:${ref.target}`);
}

async function createDiscoveryParityProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lat-discovery-parity-'));
  roots.push(root);

  const directories = [
    'src',
    'ignored',
    'caseignored',
    'nested/blocked',
    'pruned/dropped',
    'pruned/reincluded',
    '.hidden',
    'generated',
    'subproject/lat.md',
    'subproject/src',
  ];
  await Promise.all(
    directories.map((directory) =>
      mkdir(join(root, directory), { recursive: true }),
    ),
  );

  await Promise.all([
    writeFile(
      join(root, '.gitignore'),
      [
        'ignored/',
        'CaseIgnored/',
        '*.tmp.ts',
        '!kept.tmp.ts',
        'pruned/*',
        '!pruned/reincluded/',
      ].join('\n'),
    ),
    writeFile(
      join(root, 'nested', '.gitignore'),
      ['blocked/', '*.skip.ts', '!kept.skip.ts'].join('\n'),
    ),
    writeFile(join(root, 'plain.txt'), 'visible unsupported file\n'),
    writeFile(
      join(root, 'src', 'visible.ts'),
      codeReference('//', 'Specs#visible'),
    ),
    writeFile(
      join(root, 'src', 'ignored.tmp.ts'),
      codeReference('//', 'Specs#ignored temporary'),
    ),
    writeFile(
      join(root, 'src', 'kept.tmp.ts'),
      codeReference('//', 'Specs#kept temporary'),
    ),
    writeFile(
      join(root, 'ignored', 'ignored.ts'),
      codeReference('//', 'Specs#ignored directory'),
    ),
    writeFile(
      join(root, 'caseignored', 'ignored.ts'),
      codeReference('//', 'Specs#case-insensitive ignore'),
    ),
    writeFile(
      join(root, 'nested', 'visible.ts'),
      codeReference('//', 'Specs#nested visible'),
    ),
    writeFile(
      join(root, 'nested', 'discard.skip.ts'),
      codeReference('//', 'Specs#nested ignored'),
    ),
    writeFile(
      join(root, 'nested', 'kept.skip.ts'),
      codeReference('//', 'Specs#nested kept'),
    ),
    writeFile(
      join(root, 'nested', 'blocked', 'ignored.ts'),
      codeReference('//', 'Specs#nested blocked'),
    ),
    writeFile(
      join(root, 'pruned', 'dropped', 'ignored.ts'),
      codeReference('//', 'Specs#pruned'),
    ),
    writeFile(
      join(root, 'pruned', 'reincluded', 'kept.ts'),
      codeReference('//', 'Specs#reincluded'),
    ),
    writeFile(
      join(root, '.hidden', 'ignored.ts'),
      codeReference('//', 'Specs#hidden'),
    ),
    writeFile(join(root, 'generated', '.lat-ui-build'), ''),
    writeFile(
      join(root, 'generated', 'ignored.ts'),
      codeReference('//', 'Specs#generated'),
    ),
    writeFile(join(root, 'subproject', 'lat.md', 'specs.md'), '# Specs\n'),
    writeFile(
      join(root, 'subproject', 'src', 'ignored.ts'),
      codeReference('//', 'Specs#subproject'),
    ),
  ]);

  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('supported source code-reference scanning', () => {
  // @lat: [[check-code-refs#Scans only supported source files]]
  it('drives ripgrep and TypeScript scans from the source extension registry', async () => {
    const root = await createSourceProject();
    const original = process.env._LAT_DISABLE_RG;

    try {
      delete process.env._LAT_DISABLE_RG;
      const rgAvailable = await hasRipgrep();
      const preferred = await scanCodeRefs(root);
      expect(preferred.usedRg).toBe(rgAvailable);
      expectRegisteredSourcesOnly(preferred);

      process.env._LAT_DISABLE_RG = '1';
      const fallback = await scanCodeRefs(root);
      expect(fallback.usedRg).toBe(false);
      expectRegisteredSourcesOnly(fallback);
    } finally {
      if (original === undefined) delete process.env._LAT_DISABLE_RG;
      else process.env._LAT_DISABLE_RG = original;
    }
  });

  // @lat: [[tests/ts-fallback#Bounded pool preserves source order]]
  it('preserves source order across a saturated TypeScript scan pool', async () => {
    const root = await createSourceProject();
    await Promise.all(
      Array.from({ length: availableParallelism() + 1 }, (_, index) =>
        writeFile(
          join(root, 'src', `ordered-${index.toString().padStart(2, '0')}.ts`),
          codeReference('//', `Specs#ordered-${index}`),
        ),
      ),
    );
    const original = process.env._LAT_DISABLE_RG;

    try {
      process.env._LAT_DISABLE_RG = '1';
      const scan = await scanCodeRefs(root);
      const sourceOrder = scan.files
        .filter(isSourceFilePath)
        .map((file) => relative(root, file).replaceAll('\\', '/'));
      expect(scan.refs.map((ref) => ref.file)).toEqual(sourceOrder);
    } finally {
      if (original === undefined) delete process.env._LAT_DISABLE_RG;
      else process.env._LAT_DISABLE_RG = original;
    }
  });

  // @lat: [[tests/ts-fallback#Matches ripgrep discovery semantics]]
  it('keeps TypeScript and ripgrep discovery semantics in lockstep', async () => {
    const root = await createDiscoveryParityProject();
    const original = process.env._LAT_DISABLE_RG;

    try {
      process.env._LAT_DISABLE_RG = '1';
      const fallback = await scanCodeRefs(root);
      expect(relativeFiles(root, fallback)).toEqual([
        'nested/kept.skip.ts',
        'nested/visible.ts',
        'plain.txt',
        'pruned/reincluded/kept.ts',
        'src/kept.tmp.ts',
        'src/visible.ts',
      ]);

      delete process.env._LAT_DISABLE_RG;
      if (!(await hasRipgrep())) return;
      const preferred = await scanCodeRefs(root);
      expect(preferred.usedRg).toBe(true);
      expect(relativeFiles(root, preferred)).toEqual(
        relativeFiles(root, fallback),
      );
      expect(comparableRefs(preferred)).toEqual(comparableRefs(fallback));
    } finally {
      if (original === undefined) delete process.env._LAT_DISABLE_RG;
      else process.env._LAT_DISABLE_RG = original;
    }
  });
});
