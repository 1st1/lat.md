import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { rmDirBestEffort } from './util.js';
import { syncLatHooks } from '../src/cli/init.js';
import { analyzeDiff } from '../src/cli/hook.js';

const casesDir = join(import.meta.dirname, 'cases');
const cliPath = join(
  import.meta.dirname,
  '..',
  'dist',
  'src',
  'cli',
  'index.js',
);

/** Build a numstat string from [added, removed, file] tuples. */
function numstat(files: [number, number, string][]): string {
  return files.map(([a, r, f]) => `${a}\t${r}\t${f}`).join('\n');
}

/**
 * Create a temp dir with a fake `git` that dispatches on the subcommand:
 * `git diff …` prints the given numstat, `git ls-files …` prints the untracked
 * list. Cross-platform: payloads live in data files (preserving tab separators),
 * and both a POSIX `git` shell script and a Windows `git.cmd` batch shim serve
 * them — so `git diff --numstat` and `git ls-files` are intercepted on every OS.
 * Callers prepend this dir to PATH.
 */
function makeFakeGitDir(diffOutput: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lat-hook-'));
  writeFileSync(join(dir, 'diff.txt'), diffOutput);
  writeFileSync(join(dir, 'lsfiles.txt'), '');

  // POSIX: dispatch on the git subcommand ($1).
  const shScript = join(dir, 'git');
  writeFileSync(
    shScript,
    '#!/bin/sh\n' +
      'case "$1" in\n' +
      '  diff) cat "$(dirname "$0")/diff.txt" ;;\n' +
      '  ls-files) cat "$(dirname "$0")/lsfiles.txt" ;;\n' +
      'esac\n',
  );
  chmodSync(shScript, 0o755);

  // Windows: `git.cmd` batch shim (resolved via PATHEXT). `type` preserves tabs.
  const cmdScript = join(dir, 'git.cmd');
  writeFileSync(
    cmdScript,
    '@echo off\r\n' +
      'if "%1"=="diff" type "%~dp0diff.txt"\r\n' +
      'if "%1"=="ls-files" type "%~dp0lsfiles.txt"\r\n',
  );

  return dir;
}

/** Run `lat hook <agent> <event>` against a test case dir. */
function runHook(
  agent: string,
  event: string,
  caseDir: string,
  opts: {
    stopHookActive?: boolean;
    fakeBinDir?: string;
    prompt?: string;
  } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const stdinJson = JSON.stringify({
    stop_hook_active: opts.stopHookActive ?? false,
    ...(opts.prompt === undefined ? {} : { prompt: opts.prompt }),
  });

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  if (opts.fakeBinDir) {
    // Prepend using the OS path delimiter (';' on Windows). Windows env vars are
    // case-insensitive, so drop any existing `Path` key before setting `PATH` to
    // avoid the child inheriting the unmodified value under a different casing.
    const orig = env.PATH ?? env.Path ?? '';
    delete env.Path;
    delete env.PATH;
    env.PATH = opts.fakeBinDir + delimiter + orig;
  }

  const result = spawnSync('node', [cliPath, 'hook', agent, event], {
    cwd: caseDir,
    encoding: 'utf-8',
    input: stdinJson,
    env,
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

function runStopHook(
  agent: 'claude' | 'codex' | 'cursor',
  caseDir: string,
  opts: {
    stopHookActive?: boolean;
    fakeBinDir?: string;
  } = {},
): { stdout: string; stderr: string; exitCode: number } {
  return runHook(agent, agent === 'cursor' ? 'stop' : 'Stop', caseDir, opts);
}

function runGit(projectRoot: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout ?? '';
}

const clean = join(casesDir, 'hook-clean');
const broken = join(casesDir, 'error-broken-links');

describe('hook stop', () => {
  // @lat: [[tests/hook#Exits silently when check passes and no diff]]
  it('exits silently when check passes and no diff', () => {
    const fakeBinDir = makeFakeGitDir('');
    try {
      const { stdout, stderr } = runStopHook('claude', clean, { fakeBinDir });
      expect(stdout).toBe('');
      expect(stderr).toBe('');
    } finally {
      rmDirBestEffort(fakeBinDir);
    }
  });

  // @lat: [[tests/hook#Supports projects outside Git]]
  it('supports projects outside Git while keeping validation active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lat-no-git-'));
    const cleanProject = join(dir, 'clean');
    const brokenProject = join(dir, 'broken');
    cpSync(clean, cleanProject, { recursive: true });
    cpSync(broken, brokenProject, { recursive: true });

    try {
      const cleanResult = runStopHook('claude', cleanProject);
      expect(cleanResult).toEqual({ stdout: '', stderr: '', exitCode: 0 });

      const brokenResult = runStopHook('claude', brokenProject);
      expect(brokenResult.exitCode).toBe(0);
      expect(brokenResult.stderr).toBe('');
      const parsed = JSON.parse(brokenResult.stdout);
      expect(parsed.decision).toBe('block');
      expect(parsed.reason).toContain('lat check');
    } finally {
      rmDirBestEffort(dir);
    }
  });

  // @lat: [[tests/hook#Blocks when lat check fails]]
  it('blocks when lat check fails', () => {
    const { stdout } = runStopHook('claude', broken);
    const parsed = JSON.parse(stdout);
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain('lat check');
    expect(parsed.reason).toContain('error');
  });

  // @lat: [[tests/hook#Blocks when code diff is large but lat.md/ not updated]]
  it('blocks when code diff is large but lat.md/ not updated', () => {
    const fakeBinDir = makeFakeGitDir(
      numstat([[80, 30, 'src/big-refactor.ts']]),
    );
    try {
      const { stdout } = runStopHook('claude', clean, { fakeBinDir });
      const parsed = JSON.parse(stdout);
      expect(parsed.decision).toBe('block');
      expect(parsed.reason).toContain('110');
      expect(parsed.reason).toContain('lat.md/');
    } finally {
      rmDirBestEffort(fakeBinDir);
    }
  });

  // @lat: [[tests/hook#Exits silently when lat.md/ changes are proportional]]
  it('exits silently when lat.md/ changes are proportional', () => {
    const fakeBinDir = makeFakeGitDir(
      numstat([
        [60, 40, 'src/feature.ts'],
        [8, 2, 'lat.md/feature.md'],
      ]),
    );
    try {
      const { stdout } = runStopHook('claude', clean, { fakeBinDir });
      expect(stdout).toBe('');
    } finally {
      rmDirBestEffort(fakeBinDir);
    }
  });

  // @lat: [[tests/hook#Exits silently when code diff is below threshold]]
  it('exits silently when code diff is below threshold', () => {
    const fakeBinDir = makeFakeGitDir(numstat([[2, 1, 'src/tiny.ts']]));
    try {
      const { stdout } = runStopHook('claude', clean, { fakeBinDir });
      expect(stdout).toBe('');
    } finally {
      rmDirBestEffort(fakeBinDir);
    }
  });

  // @lat: [[tests/hook#Blocks with both messages when check fails and diff needs sync]]
  it('blocks with both messages when check fails and diff needs sync', () => {
    const fakeBinDir = makeFakeGitDir(numstat([[50, 60, 'src/refactor.ts']]));
    try {
      const { stdout } = runStopHook('claude', broken, { fakeBinDir });
      const parsed = JSON.parse(stdout);
      expect(parsed.decision).toBe('block');
      expect(parsed.reason).toContain('Update `lat.md/`');
      expect(parsed.reason).toContain('lat check` until it passes');
    } finally {
      rmDirBestEffort(fakeBinDir);
    }
  });

  // @lat: [[tests/hook#Exits silently on second pass when check passes]]
  it('exits silently on second pass when check passes', () => {
    const { stdout, stderr } = runStopHook('claude', clean, {
      stopHookActive: true,
    });
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  // @lat: [[tests/hook#Prints stderr warning on second pass when check still fails]]
  it('prints stderr warning on second pass when check still fails', () => {
    const { stdout, stderr } = runStopHook('claude', broken, {
      stopHookActive: true,
    });
    expect(stdout).toBe('');
    expect(stderr).toContain('still failing');
  });

  // @lat: [[tests/hook#Ignores non-code files in diff]]
  it('ignores non-code files in diff', () => {
    const fakeBinDir = makeFakeGitDir(numstat([[150, 50, 'README.md']]));
    try {
      const { stdout } = runStopHook('claude', clean, { fakeBinDir });
      expect(stdout).toBe('');
    } finally {
      rmDirBestEffort(fakeBinDir);
    }
  });

  // @lat: [[tests/hook#Cursor stop hook returns follow-up work instead of a Claude block]]
  it('returns a Cursor follow-up message when stop needs more work', () => {
    const fakeBinDir = makeFakeGitDir(
      numstat([[80, 30, 'src/big-refactor.ts']]),
    );
    try {
      const { stdout } = runStopHook('cursor', clean, { fakeBinDir });
      const parsed = JSON.parse(stdout);
      expect(parsed.followup_message).toContain('lat.md/');
      expect(parsed.followup_message).toContain('110');
      expect(parsed.decision).toBeUndefined();
    } finally {
      rmDirBestEffort(fakeBinDir);
    }
  });

  // @lat: [[tests/hook#Codex stop hook returns a block decision]]
  it('returns a Codex block decision when stop needs more work', () => {
    const fakeBinDir = makeFakeGitDir(
      numstat([[80, 30, 'src/big-refactor.ts']]),
    );
    try {
      const { stdout } = runStopHook('codex', clean, { fakeBinDir });
      const parsed = JSON.parse(stdout);
      expect(parsed.decision).toBe('block');
      expect(parsed.reason).toContain('lat.md/');
      expect(parsed.reason).toContain('110');
    } finally {
      rmDirBestEffort(fakeBinDir);
    }
  });
});

describe('Codex hook integration', () => {
  // @lat: [[tests/hook#Codex prompt hook reads the Codex prompt field]]
  it('reads the Codex prompt field and expands wiki links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lat-codex-prompt-'));
    const projectDir = join(dir, 'project');
    cpSync(clean, projectDir, { recursive: true });
    try {
      const { stdout } = runHook('codex', 'UserPromptSubmit', projectDir, {
        prompt: 'Update [[feature]]',
      });
      const parsed = JSON.parse(stdout);
      const context = parsed.hookSpecificOutput.additionalContext;
      expect(context).toContain('Expanded user prompt');
      expect(context).toContain('[[lat.md/feature#Feature]]');
    } finally {
      rmDirBestEffort(dir);
    }
  });

  // @lat: [[tests/hook#Codex hook setup preserves non-lat hooks]]
  it('syncs Codex hooks while preserving non-lat hooks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lat-codex-hooks-'));
    const hooksPath = join(dir, 'hooks.json');
    writeFileSync(
      hooksPath,
      JSON.stringify({
        description: 'Workspace hooks',
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [{ type: 'command', command: 'custom prompt hook' }],
            },
            {
              hooks: [
                {
                  type: 'command',
                  command: 'lat hook claude UserPromptSubmit',
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [{ type: 'command', command: 'lat hook codex Stop' }],
            },
          ],
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'custom tool hook' }],
            },
          ],
        },
      }),
    );

    try {
      syncLatHooks(hooksPath, 'global', 'codex');
      const config = JSON.parse(readFileSync(hooksPath, 'utf-8'));
      expect(config.description).toBe('Workspace hooks');
      expect(config.hooks.PreToolUse).toHaveLength(1);
      expect(config.hooks.UserPromptSubmit).toHaveLength(2);
      expect(config.hooks.UserPromptSubmit[0].hooks[0].command).toBe(
        'custom prompt hook',
      );
      expect(config.hooks.UserPromptSubmit[1].hooks[0].command).toBe(
        'lat hook codex UserPromptSubmit',
      );
      expect(config.hooks.Stop).toHaveLength(1);
      expect(config.hooks.Stop[0].hooks[0].command).toBe('lat hook codex Stop');
    } finally {
      rmDirBestEffort(dir);
    }
  });

  // @lat: [[tests/hook#Local JavaScript hook commands retain Node]]
  it('runs a local JavaScript CLI through Node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lat-codex-local-hooks-'));
    const hooksPath = join(dir, 'hooks.json');
    const cliPath = join(dir, 'index.js');
    const originalScript = process.argv[1];

    try {
      writeFileSync(
        cliPath,
        'process.stdout.write(process.argv.slice(2).join(" "));\n',
      );
      process.argv[1] = cliPath;
      syncLatHooks(hooksPath, 'local', 'codex');

      const config = JSON.parse(readFileSync(hooksPath, 'utf-8'));
      const quote = (arg: string) => (arg.includes(' ') ? `"${arg}"` : arg);
      const command = config.hooks.Stop[0].hooks[0].command;
      expect(command).toBe(
        `${quote(process.execPath)} ${quote(cliPath)} hook codex Stop`,
      );

      const result = spawnSync(command, { shell: true, encoding: 'utf-8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('hook codex Stop');
    } finally {
      process.argv[1] = originalScript;
      rmDirBestEffort(dir);
    }
  });
});

describe('analyzeDiff', () => {
  // @lat: [[tests/hook#Counts tracked and untracked files together]]
  it('counts relevant untracked files and respects nested gitignores', () => {
    const proj = mkdtempSync(join(tmpdir(), 'lat-untracked-'));
    try {
      mkdirSync(join(proj, 'lat.md'), { recursive: true });
      mkdirSync(join(proj, 'lat.md', '.cache'), { recursive: true });
      mkdirSync(join(proj, 'src'), { recursive: true });
      mkdirSync(join(proj, 'src', 'generated'), { recursive: true });
      writeFileSync(join(proj, 'lat.md', '.gitignore'), '.cache/\n');
      writeFileSync(join(proj, 'src', '.gitignore'), 'generated/\n');
      writeFileSync(join(proj, 'src', 'tracked.ts'), 'before\n');

      runGit(proj, ['init', '--quiet']);
      runGit(proj, ['config', 'user.email', 'lat@example.com']);
      runGit(proj, ['config', 'user.name', 'Lat Tests']);
      runGit(proj, [
        'add',
        'lat.md/.gitignore',
        'src/.gitignore',
        'src/tracked.ts',
      ]);
      runGit(proj, ['commit', '--quiet', '-m', 'initial']);

      writeFileSync(join(proj, 'src', 'tracked.ts'), 'changed\n'.repeat(110));
      writeFileSync(join(proj, 'lat.md', 'feature.md'), 'x\n'.repeat(60));
      writeFileSync(join(proj, 'src', 'brand-new.ts'), 'y\n'.repeat(20));
      writeFileSync(join(proj, 'src', 'with space.ts'), 's\n'.repeat(3));
      writeFileSync(join(proj, 'src', 'café.ts'), 'u\n'.repeat(7));
      writeFileSync(
        join(proj, 'lat.md', '.cache', 'ignored.md'),
        'ignored\n'.repeat(500),
      );
      writeFileSync(
        join(proj, 'src', 'generated', 'ignored.ts'),
        'ignored\n'.repeat(500),
      );
      writeFileSync(join(proj, 'archive.tgz'), 'unrelated\n'.repeat(500));

      expect(analyzeDiff(proj)).toEqual({
        codeLines: 141,
        latMdLines: 60,
      });
    } finally {
      rmDirBestEffort(proj);
    }
  });

  // @lat: [[tests/hook#Counts untracked files before the first commit]]
  it('counts untracked files in a repository without HEAD', () => {
    const proj = mkdtempSync(join(tmpdir(), 'lat-unborn-'));
    try {
      runGit(proj, ['init', '--quiet']);
      mkdirSync(join(proj, 'lat.md'), { recursive: true });
      mkdirSync(join(proj, 'src'), { recursive: true });
      writeFileSync(join(proj, 'lat.md', 'feature.md'), 'x\n'.repeat(12));
      writeFileSync(join(proj, 'src', 'feature.ts'), 'y\n'.repeat(8));

      expect(analyzeDiff(proj)).toEqual({ codeLines: 8, latMdLines: 12 });
    } finally {
      rmDirBestEffort(proj);
    }
  });
});
