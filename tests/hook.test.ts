import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { rmDirBestEffort } from './util.js';
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
function makeFakeGitDir(diffOutput: string, lsFilesOutput = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'lat-hook-'));
  writeFileSync(join(dir, 'diff.txt'), diffOutput);
  writeFileSync(join(dir, 'lsfiles.txt'), lsFilesOutput);

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
  } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const stdinJson = JSON.stringify({
    stop_hook_active: opts.stopHookActive ?? false,
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
  agent: 'claude' | 'cursor',
  caseDir: string,
  opts: {
    stopHookActive?: boolean;
    fakeBinDir?: string;
  } = {},
): { stdout: string; stderr: string; exitCode: number } {
  return runHook(agent, agent === 'claude' ? 'Stop' : 'stop', caseDir, opts);
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
      numstat([[60, 40, 'src/feature.ts'], [8, 2, 'lat.md/feature.md']]),
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
});

describe('analyzeDiff', () => {
  // @lat: [[tests/hook#Counts untracked lat.md/ and source files]]
  it('counts untracked lat.md/ and source files, not just tracked changes', () => {
    const proj = mkdtempSync(join(tmpdir(), 'lat-untracked-'));
    try {
      // A freshly scaffolded, never-committed lat.md/ (60 lines) plus an
      // untracked source file (20 lines) — the issue #61 scenario.
      mkdirSync(join(proj, 'lat.md'), { recursive: true });
      mkdirSync(join(proj, 'src'), { recursive: true });
      writeFileSync(join(proj, 'lat.md', 'feature.md'), 'x\n'.repeat(60));
      writeFileSync(join(proj, 'src', 'brand-new.ts'), 'y\n'.repeat(20));

      // Fake git: 110 tracked code lines + both untracked files listed.
      const fakeBinDir = makeFakeGitDir(
        numstat([[80, 30, 'src/refactor.ts']]),
        'lat.md/feature.md\nsrc/brand-new.ts\n',
      );
      const savedPath = process.env.PATH;
      process.env.PATH = fakeBinDir + delimiter + (savedPath ?? '');
      try {
        const { codeLines, latMdLines } = analyzeDiff(proj);
        // Untracked lat.md/ is counted (previously read as 0 → perpetual nag).
        expect(latMdLines).toBe(60);
        // Tracked (110) + untracked source (20).
        expect(codeLines).toBe(130);
      } finally {
        process.env.PATH = savedPath;
        rmDirBestEffort(fakeBinDir);
      }
    } finally {
      rmDirBestEffort(proj);
    }
  });
});
