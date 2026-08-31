import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasRipgrep, scanCodeRefs, type ScanResult } from '../src/code-refs.js';
import { SOURCE_FILE_EXTENSIONS } from '../src/source-formats.js';

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
});
