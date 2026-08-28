import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createExternalResolver,
  externalCachePaths,
  inferExternalFetchUrl,
  loadExternalSources,
  normalizeExternalRepoUrl,
  parseExternalTarget,
  readExternalCacheMetadata,
} from '../../src/external-sources.js';
import {
  createExternalGitFixture,
  createExternalProject,
  TEST_CERT_PATH,
  type ExternalGitFixture,
} from './support.js';
import { rmDirBestEffort } from '../util.js';

function replaceProjectCommit(latDir: string, from: string, to: string): void {
  const path = join(latDir, 'lat.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
}

describe.sequential('external source core', () => {
  let fixture: ExternalGitFixture;
  const projects: string[] = [];
  const previousCa = process.env.GIT_SSL_CAINFO;

  beforeAll(async () => {
    fixture = await createExternalGitFixture();
    process.env.GIT_SSL_CAINFO = TEST_CERT_PATH;
  }, 30_000);

  afterAll(async () => {
    if (previousCa === undefined) delete process.env.GIT_SSL_CAINFO;
    else process.env.GIT_SSL_CAINFO = previousCa;
    for (const project of projects) rmDirBestEffort(project);
    await fixture.close();
  });

  // @lat: [[tests/external-tests#External Sources#Configuration and targets]]
  it('validates canonical config and portable external targets', async () => {
    expect(
      normalizeExternalRepoUrl('https://GitHub.com/Vercel/Next.js.git/'),
    ).toBe('https://github.com/Vercel/Next.js');
    expect(inferExternalFetchUrl('https://github.com/vercel/next.js')).toBe(
      'https://raw.githubusercontent.com/vercel/next.js/{commit}/{path}',
    );
    expect(() =>
      normalizeExternalRepoUrl('git@github.com:vercel/next.js'),
    ).toThrow('absolute HTTPS URL');
    expect(() =>
      normalizeExternalRepoUrl('https://token@github.com/vercel/next.js'),
    ).toThrow('credential-free HTTPS');

    const root = mkdtempSync(join(tmpdir(), 'lat-external-config-'));
    projects.push(root);
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir);
    writeFileSync(
      join(latDir, 'lat.md'),
      `---\nlat:\n  external-sources:\n    docs_api:\n      repo: https://example.com/Project.git\n      commit: ${'a'.repeat(40)}\n      prefix: docs\n      strategy: fetch\n      fetch-url: https://example.com/raw/{commit}/{path}\n---\n# Root\n\nRoot docs.\n`,
    );
    const snapshot = await loadExternalSources(latDir, root);
    expect(snapshot.errors).toEqual([]);
    expect(snapshot.sources.get('docs_api')?.repo).toBe(
      'https://example.com/Project.git',
    );
    expect(
      parseExternalTarget('docs_api:guide/start.md#Install', snapshot),
    ).toMatchObject({
      authoredPath: 'guide/start.md',
      repositoryPath: 'docs/guide/start.md',
      fragment: 'Install',
    });
    expect(() =>
      parseExternalTarget('docs_api:guide\\start.md', snapshot),
    ).toThrow('relative POSIX path');
    expect(() =>
      parseExternalTarget('docs_api:../secret.md', snapshot),
    ).toThrow('cannot contain');
    expect(() => parseExternalTarget('docs_api:guide.rst', snapshot)).toThrow(
      'unsupported external file extension',
    );
    expect(() =>
      parseExternalTarget('docs_api:guide.md#L10-L20', snapshot),
    ).toThrow('cannot use line numbers');
    expect(parseExternalTarget('unknown:guide.md', snapshot)).toBeNull();

    writeFileSync(
      join(latDir, 'lat.md'),
      readFileSync(join(latDir, 'lat.md'), 'utf8').replace(
        'https://example.com/raw/{commit}/{path}',
        'https://example.com/raw/{commit}/{unknown}',
      ),
    );
    expect(
      (await loadExternalSources(latDir, root)).errors[0].message,
    ).toContain('fetch-url must contain {path}');
  });

  // @lat: [[tests/external-tests#External Sources#Retrieval strategies]]
  it('reads through fetch, managed checkout, and dirty local providers', async () => {
    const fetched = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
    });
    projects.push(fetched.root);
    const fetchResolver = await createExternalResolver(
      fetched.latDir,
      fetched.root,
      { ca: fixture.ca },
    );
    const [first, second] = await Promise.all([
      fetchResolver.resolve('upstream:guide.md#Navigation'),
      fetchResolver.resolve('upstream:guide.md#Navigation'),
    ]);
    expect(first.content).toContain('First version navigation.');
    expect(second.provider).toBe('fetch');
    expect(fixture.rawRequests.get(`${fixture.commit1}:docs/guide.md`)).toBe(1);

    const checkout = createExternalProject(fixture, {
      strategy: 'checkout',
      commit: fixture.commit2,
    });
    projects.push(checkout.root);
    const checkoutResult = await (
      await createExternalResolver(checkout.latDir, checkout.root)
    ).resolve('upstream:guide.md#Navigation');
    expect(checkoutResult.provider).toBe('checkout');
    expect(checkoutResult.content).toContain('Second version navigation.');
    expect(checkoutResult.fullContent.endsWith('\n')).toBe(true);
    const checkoutCache = externalCachePaths(checkout.latDir, 'upstream');
    execFileSync('git', [
      '-C',
      checkoutCache.directory,
      'remote',
      'set-url',
      'origin',
      'https://example.com/wrong.git',
    ]);
    const repaired = await (
      await createExternalResolver(checkout.latDir, checkout.root)
    ).resolve('upstream:guide.md#Navigation');
    expect(repaired.content).toContain('Second version navigation.');
    expect(
      execFileSync(
        'git',
        ['-C', checkoutCache.directory, 'remote', 'get-url', 'origin'],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe(fixture.repoUrl);

    const fallback = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
      localPath: fixture.checkout,
    });
    projects.push(fallback.root);
    const fallbackResolver = await createExternalResolver(
      fallback.latDir,
      fallback.root,
      { ca: fixture.ca },
    );
    expect(fallbackResolver.snapshot.errors[0].message).toContain(
      `expected ${fixture.commit1}`,
    );
    expect(
      (await fallbackResolver.resolve('upstream:guide.md#Navigation')).provider,
    ).toBe('fetch');

    const local = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit2,
      localPath: fixture.checkout,
    });
    projects.push(local.root);
    writeFileSync(
      join(fixture.checkout, 'docs', 'guide.md'),
      '# Guide\n\nPinned guide.\n\n## Navigation\n\nDirty local navigation.\n',
    );
    const localResolver = await createExternalResolver(
      local.latDir,
      local.root,
      { ca: fixture.ca },
    );
    expect(localResolver.snapshot.errors).toEqual([]);
    const localResult = await localResolver.resolve(
      'upstream:guide.md#Navigation',
    );
    expect(localResult.provider).toBe('local');
    expect(localResult.content).toContain('Dirty local navigation.');
  }, 30_000);

  // @lat: [[tests/external-tests#External Sources#Cache reconciliation]]
  it('replaces generations, removes stale bytes, and evicts removed sources', async () => {
    const project = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit1,
    });
    projects.push(project.root);
    const target = 'upstream:guide.md#Navigation';
    await (
      await createExternalResolver(project.latDir, project.root, {
        ca: fixture.ca,
      })
    ).resolve(target);
    const paths = externalCachePaths(project.latDir, 'upstream');
    expect(
      readFileSync(join(paths.directory, 'docs', 'guide.md'), 'utf8'),
    ).toContain('First version');

    replaceProjectCommit(project.latDir, fixture.commit1, fixture.commit2);
    const changed = await createExternalResolver(project.latDir, project.root, {
      ca: fixture.ca,
    });
    expect((await changed.resolve(target)).content).toContain('Second version');
    expect(readExternalCacheMetadata(project.latDir, 'upstream')).toMatchObject(
      { commit: fixture.commit2, strategy: 'fetch' },
    );

    replaceProjectCommit(project.latDir, fixture.commit2, 'd'.repeat(40));
    const broken = await createExternalResolver(project.latDir, project.root, {
      ca: fixture.ca,
    });
    await expect(broken.resolve(target)).rejects.toThrow('HTTP 404');
    expect(existsSync(join(paths.directory, 'docs', 'guide.md'))).toBe(false);

    const origin = new URL(fixture.repoUrl).origin;
    const insecurePath = join(project.latDir, 'lat.md');
    writeFileSync(
      insecurePath,
      readFileSync(insecurePath, 'utf8')
        .replace('d'.repeat(40), fixture.commit2)
        .replace(
          fixture.fetchUrl,
          `${origin}/redirect-insecure/{commit}/{path}`,
        ),
    );
    await expect(
      (
        await createExternalResolver(project.latDir, project.root, {
          ca: fixture.ca,
        })
      ).resolve(target),
    ).rejects.toThrow('credential-free HTTPS URL');

    writeFileSync(
      insecurePath,
      readFileSync(insecurePath, 'utf8').replace(
        `${origin}/redirect-insecure/{commit}/{path}`,
        `${origin}/large/{commit}/{path}`,
      ),
    );
    await expect(
      (
        await createExternalResolver(project.latDir, project.root, {
          ca: fixture.ca,
        })
      ).resolve(target),
    ).rejects.toThrow('response exceeds');

    writeFileSync(
      join(project.latDir, 'lat.md'),
      '# Project\n\nExternal source removed.\n',
    );
    await (
      await createExternalResolver(project.latDir, project.root, {
        ca: fixture.ca,
      })
    ).reconcile();
    expect(existsSync(paths.directory)).toBe(false);
    expect(existsSync(paths.metadata)).toBe(false);
  }, 30_000);
});
