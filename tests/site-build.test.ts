import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repositoryRoot = join(import.meta.dirname, '..');

describe('repository site build', () => {
  // @lat: [[lat.md/view/specs#View Tests#Builds this repository's site directly]]
  it('uses the ignored default server artifact for one Vercel build', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(rootPackage.scripts['build:site']).toBe(
      'pnpm --filter @lat.md/server build && node scripts/prepare-site-packages.mjs && pnpm build && node dist/src/cli/index.js ui build server --force && node scripts/copy-site-assets.mjs',
    );
    expect(rootPackage.scripts['build:site:vercel']).toBe(
      'pnpm build:site && node scripts/vendor-site-packages.mjs && npm install --prefix .lat-build/server --ignore-scripts --no-package-lock && node scripts/build-vercel-output.mjs',
    );
    expect(rootPackage.scripts['build:site:source']).toBe(
      'pnpm buildall && node dist/src/cli/index.js ui build server --force && node scripts/copy-site-assets.mjs',
    );

    const vercelBuild = readFileSync(
      join(repositoryRoot, 'scripts', 'build-vercel-output.mjs'),
      'utf8',
    );
    expect(vercelBuild).toContain('buildVercelOutput');
    expect(vercelBuild).toContain("process.argv[2] ?? '.lat-build/server'");

    const vendorBuild = readFileSync(
      join(repositoryRoot, 'scripts', 'vendor-site-packages.mjs'),
      'utf8',
    );
    expect(vendorBuild).toContain("process.argv[2] ?? '.lat-build/server'");
    expect(vendorBuild).toContain("createHash('sha256')");

    const gitIgnore = readFileSync(
      join(repositoryRoot, '.gitignore'),
      'utf8',
    ).split('\n');
    expect(gitIgnore).toContain('.lat-build');
    expect(gitIgnore).not.toContain('web');
  });

  // @lat: [[lat.md/view/specs#View Tests#Publishes the website's agent guide]]
  it('copies the minimal root llms.txt unchanged without deep documentation links', () => {
    const output = mkdtempSync(join(tmpdir(), 'lat-site-assets-'));
    try {
      execFileSync(
        process.execPath,
        [join(repositoryRoot, 'scripts', 'copy-site-assets.mjs'), output],
        { cwd: output },
      );
      const source = readFileSync(join(repositoryRoot, 'llms.txt'), 'utf8');
      expect(readFileSync(join(output, 'llms.txt'), 'utf8')).toBe(source);
      expect(source).toMatch(/^# Lat\n/);
      expect(source).toContain('npm install -g lat.md');
      expect(source).toContain('lat init');
      expect(source).toContain('[Lat website](https://lat.md/)');
      expect(source).not.toContain('/docs/');
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});
