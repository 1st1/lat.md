import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { plainStyler, type CmdContext } from '../src/context.js';
import { checkCodeRefs, checkIndex, checkMd } from '../src/cli/check.js';
import { findRefs } from '../src/cli/refs.js';
import { expandPrompt } from '../src/cli/expand.js';
import { getSourceCommand } from '../src/cli/get-source.js';
import { formatSectionOutput, getSection } from '../src/cli/section.js';

function commitRepo(dir: string, message: string): void {
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync(
    `git -c user.name=test -c user.email=test@example.com commit -m ${JSON.stringify(message)}`,
    {
      cwd: dir,
      stdio: 'ignore',
    },
  );
}

function makeProject(
  opts: {
    rev?: string;
    localPath?: string;
    includeLocalConfig?: boolean;
  } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'lat-external-project-'));
  const latDir = join(root, 'lat.md');
  mkdirSync(latDir, { recursive: true });

  writeFileSync(join(latDir, '.gitignore'), 'config.local.json\n');
  writeFileSync(
    join(latDir, 'lat.md'),
    `---
lat:
  external-sources:
    architecture-docs:
      repo: https://example.com/architecture-docs.git
      rev: ${opts.rev ?? 'v6.9'}
      browse: https://example.com/architecture-docs/tree/{path}?h={rev}#{fragment}
---
# lat.md

Directory index and canonical external source mappings for this fixture.

- [[docs]] — Example docs that link to an external source.
`,
  );
  writeFileSync(
    join(latDir, 'docs.md'),
    `# Docs

Example section used to verify external-source resolution across commands.

See [[architecture-docs:docs/system/request-flow.md#L123]] for the referenced design note.
`,
  );

  if (opts.includeLocalConfig || opts.localPath) {
    writeFileSync(
      join(latDir, 'config.local.json'),
      JSON.stringify(
        {
          lat: {
            'external-sources': {
              'architecture-docs': opts.localPath
                ? { path: opts.localPath }
                : {},
            },
          },
        },
        null,
        2,
      ) + '\n',
    );
  }

  return root;
}

function makeExternalRepo(
  opts: { secondCommit?: boolean; baseDir?: string } = {},
): {
  dir: string;
  rev: string;
} {
  const dir = mkdtempSync(join(opts.baseDir ?? tmpdir(), 'lat-external-repo-'));
  mkdirSync(join(dir, 'docs', 'system'), { recursive: true });
  writeFileSync(
    join(dir, 'docs', 'system', 'request-flow.md'),
    'Request flow architecture notes.\n',
  );

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  commitRepo(dir, 'init');
  const rev = execSync('git rev-parse HEAD', {
    cwd: dir,
    encoding: 'utf-8',
  }).trim();

  if (opts.secondCommit) {
    writeFileSync(
      join(dir, 'docs', 'system', 'request-flow.md'),
      'Updated request flow architecture notes.\n',
    );
    commitRepo(dir, 'update');
  }

  return { dir, rev };
}

function makeAsciiDocRepo(): {
  dir: string;
  rev: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'lat-external-adoc-'));
  mkdirSync(join(dir, 'design', 'XFS_Filesystem_Structure'), {
    recursive: true,
  });
  writeFileSync(
    join(
      dir,
      'design',
      'XFS_Filesystem_Structure',
      'extended_attributes.asciidoc',
    ),
    `= XFS Filesystem Structure\n\nIntro.\n\n== Extended Attributes\n\nLayout details.\n\n[#custom-layout]\n== Custom Layout\n\nCustom layout details.\n\n== Remote Attributes\n\nRemote details.\n`,
  );

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  commitRepo(dir, 'init');

  const rev = execSync('git rev-parse HEAD', {
    cwd: dir,
    encoding: 'utf-8',
  }).trim();
  return { dir, rev };
}

function ctxFor(root: string): CmdContext {
  return {
    latDir: join(root, 'lat.md'),
    projectRoot: root,
    styler: plainStyler,
    mode: 'cli',
  };
}

function writeExternalCodeRef(
  root: string,
  target = 'architecture-docs:docs/system/request-flow.md#L123',
): void {
  const marker = '@lat:';
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'app.ts'),
    `// ${marker} [[${target}]]\nexport const answer = 42;\n`,
  );
}

function writeDocsRef(
  root: string,
  target = 'architecture-docs:docs/system/request-flow.md#L123',
): void {
  writeFileSync(
    join(root, 'lat.md', 'docs.md'),
    `# Docs\n\nExample section used to verify external-source resolution across commands.\n\nSee [[${target}]] for the referenced design note.\n`,
  );
}

describe('external sources', () => {
  // @lat: [[external-sources#Check md accepts configured external refs]]
  it('check md accepts configured external refs', async () => {
    const root = makeProject({ includeLocalConfig: true });
    try {
      const { errors } = await checkMd(join(root, 'lat.md'));
      expect(errors).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Check code-refs accepts configured external refs]]
  it('check code-refs accepts configured external refs in source comments', async () => {
    const root = makeProject();
    writeExternalCodeRef(root);
    try {
      const { errors, files } = await checkCodeRefs(join(root, 'lat.md'));
      expect(errors).toHaveLength(0);
      expect(files).toEqual({ '.ts': 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Index allows config.local.json]]
  it('check index ignores config.local.json inside lat.md', async () => {
    const root = makeProject({ includeLocalConfig: true });
    try {
      const errors = await checkIndex(join(root, 'lat.md'));
      expect(errors).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Refs finds markdown backlinks for external target]]
  it('finds markdown backlinks for an external target', async () => {
    const root = makeProject();
    try {
      const result = await findRefs(
        ctxFor(root),
        'architecture-docs:docs/system/request-flow.md#L123',
        'md',
      );
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.mdRefs).toHaveLength(1);
        expect(result.mdRefs[0].section.id).toBe('lat.md/docs#Docs');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Refs finds code backlinks for external target]]
  it('finds code backlinks for an external target', async () => {
    const root = makeProject();
    writeExternalCodeRef(root);
    try {
      const result = await findRefs(
        ctxFor(root),
        'architecture-docs:docs/system/request-flow.md#L123',
        'code',
      );
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.mdRefs).toHaveLength(0);
        expect(result.codeRefs).toHaveLength(1);
        expect(result.codeRefs[0]).toMatch(/src\/app\.ts:1$/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Section output renders external destination]]
  it('renders local external destinations in section output when pinned repo is available', async () => {
    const repo = makeExternalRepo();
    const root = makeProject({ rev: repo.rev, localPath: repo.dir });
    try {
      const result = await getSection(ctxFor(root), 'lat.md/docs#Docs');
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.outgoingExternalRefs).toHaveLength(1);
        expect(result.outgoingExternalRefs[0].activeKind).toBe('local');
        const output = formatSectionOutput(ctxFor(root), result);
        expect(output).toContain('file://');
        expect(output).toContain('docs/system/request-flow.md:123');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Section output resolves autogenerated AsciiDoc heading ids]]
  it('resolves autogenerated AsciiDoc heading ids to local line ranges', async () => {
    const repo = makeAsciiDocRepo();
    const root = makeProject({ rev: repo.rev, localPath: repo.dir });
    writeDocsRef(
      root,
      'architecture-docs:design/XFS_Filesystem_Structure/extended_attributes.asciidoc#_extended_attributes',
    );
    try {
      const result = await getSection(ctxFor(root), 'lat.md/docs#Docs');
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.outgoingExternalRefs).toHaveLength(1);
        expect(result.outgoingExternalRefs[0].line).toBe(5);
        expect(result.outgoingExternalRefs[0].endLine).toBe(9);
        const output = formatSectionOutput(ctxFor(root), result);
        expect(output).toContain('extended_attributes.asciidoc:5-9');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Expand resolves explicit AsciiDoc heading ids]]
  it('resolves explicit AsciiDoc heading ids during prompt expansion', async () => {
    const repo = makeAsciiDocRepo();
    const root = makeProject({ rev: repo.rev, localPath: repo.dir });
    try {
      const output = await expandPrompt(
        ctxFor(root),
        'Inspect [[architecture-docs:design/XFS_Filesystem_Structure/extended_attributes.asciidoc#custom-layout]]',
      );
      expect(output).toContain('external source architecture-docs');
      expect(output).toContain('extended_attributes.asciidoc:10-13');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Tilde path expands to home directory]]
  it('expands ~ in local external source paths', async () => {
    const home = mkdtempSync(join(tmpdir(), 'lat-external-home-'));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    let root: string | undefined;
    try {
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      const repo = makeExternalRepo({ baseDir: home });
      const tildePath = `~/${relative(home, repo.dir)}`;
      root = makeProject({ rev: repo.rev, localPath: tildePath });

      const { errors } = await checkMd(join(root, 'lat.md'));
      expect(errors).toHaveLength(0);

      const result = await getSection(ctxFor(root), 'lat.md/docs#Docs');
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.outgoingExternalRefs[0].activeKind).toBe('local');
        expect(result.outgoingExternalRefs[0].localPath).toContain(
          'docs/system/request-flow.md',
        );
      }
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Expand includes external context]]
  it('adds external-source context during prompt expansion', async () => {
    const root = makeProject();
    try {
      const output = await expandPrompt(
        ctxFor(root),
        'Inspect [[architecture-docs:docs/system/request-flow.md#L123]]',
      );
      expect(output).toContain('external source architecture-docs');
      expect(output).toContain(
        'https://example.com/architecture-docs/tree/docs/system/request-flow.md?h=v6.9#L123',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Check md reports stale local external revision]]
  it('reports stale local external revisions', async () => {
    const repo = makeExternalRepo({ secondCommit: true });
    const root = makeProject({ rev: repo.rev, localPath: repo.dir });
    try {
      const { errors } = await checkMd(join(root, 'lat.md'));
      expect(errors.some((err) => err.message.includes('expected'))).toBe(true);
      expect(
        errors.some((err) =>
          err.message.includes('external source "architecture-docs"'),
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Check md can ignore local overrides]]
  it('can ignore local external overrides during check', async () => {
    const repo = makeExternalRepo({ secondCommit: true });
    const root = makeProject({ rev: repo.rev, localPath: repo.dir });
    try {
      const { errors } = await checkMd(join(root, 'lat.md'), {
        ignoreLocalOverrides: true,
      });
      expect(errors).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Get source returns canonical repo URL]]
  it('returns the canonical repo URL when no local override is active', async () => {
    const root = makeProject();
    try {
      const result = await getSourceCommand(ctxFor(root), 'architecture-docs');
      expect(result.output).toBe('https://example.com/architecture-docs.git');
      expect(result.isError).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // @lat: [[external-sources#Get source returns local repo path]]
  it('returns the local checkout path when a pinned override is active', async () => {
    const repo = makeExternalRepo();
    const root = makeProject({ rev: repo.rev, localPath: repo.dir });
    try {
      const result = await getSourceCommand(ctxFor(root), 'architecture-docs');
      expect(result.output).toBe(repo.dir);
      expect(result.isError).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});
