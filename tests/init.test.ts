import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import xdg from '@folder/xdg';
import {
  INIT_VERSION,
  readInitVersion,
  writeInitMeta,
} from '../src/init-version.js';
import { analyzeMarkdownFile } from '../src/markdown-analysis.js';
import {
  readAgentsTemplate,
  readCursorRulesTemplate,
  readSkillTemplate,
} from '../src/cli/gen.js';

const cliPath = join(
  import.meta.dirname,
  '..',
  'dist',
  'src',
  'cli',
  'index.js',
);
const disableNetworkUrl = pathToFileURL(
  join(import.meta.dirname, 'support', 'disable-network.mjs'),
).href;
const seedDbPath = join(import.meta.dirname, 'support', 'seed-model.mjs');

const {
  closeDb,
  ensureMeta,
  getLlmKey,
  getRepoEmbedding,
  getStoredModel,
  openDb,
  reindexCommand,
  selectMenu,
  setRepoEmbedding,
} = vi.hoisted(() => ({
  closeDb: vi.fn(async () => {}),
  ensureMeta: vi.fn(async () => {}),
  getLlmKey: vi.fn(),
  getRepoEmbedding: vi.fn(),
  getStoredModel: vi.fn(async () => null as string | null),
  openDb: vi.fn(() => ({})),
  reindexCommand: vi.fn(),
  selectMenu: vi.fn(),
  setRepoEmbedding: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  getLlmKey,
  getRepoEmbedding,
  setRepoEmbedding,
}));
vi.mock('../src/version.js', () => ({
  fetchLatestVersion: vi.fn(async () => null),
  getLocalVersion: vi.fn(() => 'test'),
}));
vi.mock('../src/cli/checklist-menu.js', () => ({
  checklistMenu: vi.fn(async () => []),
}));
vi.mock('../src/cli/select-menu.js', () => ({ selectMenu }));
vi.mock('../src/cli/reindex.js', () => ({ reindexCommand }));
vi.mock('../src/search/db.js', () => ({
  closeDb,
  ensureMeta,
  getStoredModel,
  openDb,
}));

import { initCmd } from '../src/cli/init.js';

describe('generated Markdown templates', () => {
  // @lat: [[init#Generated instructions#Templates satisfy graph validation]]
  it('satisfies local graph validation in every Markdown template', () => {
    const templates = [
      ['AGENTS.md', readAgentsTemplate()],
      ['cursor-rules.md', readCursorRulesTemplate()],
      ['SKILL.md', readSkillTemplate()],
    ] as const;

    for (const [name, content] of templates) {
      const analysis = analyzeMarkdownFile(
        `/project/lat.md/${name}`,
        content,
        '/project/lat.md',
        '/project',
      );
      expect(analysis.diagnostics, name).toEqual([]);
    }
  });
});

type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

describe('lat init embedding setup', () => {
  let root: string;
  let stdinIsTTY: PropertyDescriptor | undefined;

  function latDir(): string {
    return join(root, 'lat.md');
  }

  function configPath(): string {
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(root, '.config'),
    };
    return join(xdg({ env }).config, 'lat', 'config.json');
  }

  function createLatDir(): void {
    mkdirSync(latDir(), { recursive: true });
  }

  /** Stamp a setup one version behind, so init treats it as outdated. */
  function writeOutdatedInitMeta(): void {
    createLatDir();
    writeInitMeta(latDir(), {});
    const path = join(latDir(), '.cache', 'lat_init.json');
    const meta = JSON.parse(readFileSync(path, 'utf-8')) as {
      init_version: number;
    };
    meta.init_version = INIT_VERSION - 1;
    writeFileSync(path, JSON.stringify(meta, null, 2) + '\n');
  }

  function writeRepoEmbedding(embedding: 'local'): void {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        { repos: { [resolve(latDir())]: { embedding } } },
        null,
        2,
      ) + '\n',
    );
  }

  function readRepoEmbedding(): 'local' | undefined {
    if (!existsSync(configPath())) return undefined;
    const config = JSON.parse(readFileSync(configPath(), 'utf-8')) as {
      repos?: Record<string, { embedding?: 'local' }>;
    };
    return config.repos?.[resolve(latDir())]?.embedding;
  }

  function seedStoredModel(model: string): void {
    createLatDir();
    const result = spawnSync(process.execPath, [seedDbPath, latDir(), model], {
      encoding: 'utf-8',
    });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
  }

  function mockStoredModel(model: string): void {
    mkdirSync(join(latDir(), '.cache'), { recursive: true });
    writeFileSync(join(latDir(), '.cache', 'vectors.db'), '');
    getStoredModel.mockResolvedValue(model);
  }

  function runInit(key?: string): CliResult {
    const result = spawnSync(
      process.execPath,
      ['--import', disableNetworkUrl, cliPath, '--no-color', 'init', root],
      {
        cwd: root,
        encoding: 'utf-8',
        env: {
          ...process.env,
          XDG_CONFIG_HOME: join(root, '.config'),
          LAT_LLM_KEY: key ?? '',
          LAT_LLM_KEY_FILE: '',
          LAT_LLM_KEY_HELPER: '',
          NO_COLOR: '1',
        },
      },
    );
    if (result.error) throw result.error;
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.status ?? 1,
    };
  }

  function expectSuccess(result: CliResult): void {
    expect(result.exitCode, result.stderr).toBe(0);
  }

  function setInteractive(interactive: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: interactive,
    });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lat-init-'));
    stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    setInteractive(false);
    closeDb.mockClear();
    ensureMeta.mockClear();
    getLlmKey.mockReset();
    getRepoEmbedding.mockReset();
    getStoredModel.mockReset();
    getStoredModel.mockResolvedValue(null);
    openDb.mockClear();
    reindexCommand.mockReset();
    reindexCommand.mockResolvedValue({ output: 'Reindexed.' });
    selectMenu.mockReset();
    setRepoEmbedding.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (stdinIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', stdinIsTTY);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
    rmSync(root, { recursive: true, force: true });
  });

  // @lat: [[init#Embedding setup#Fresh init pins local embeddings]]
  it('pins local embeddings before agent selection on a fresh init', () => {
    const result = runInit('sk-test');

    expectSuccess(result);
    expect(readRepoEmbedding()).toBe('local');
    expect(readInitVersion(latDir())).toBe(INIT_VERSION);
  });

  // @lat: [[init#Embedding setup#Configured key asks for a backend]]
  it('allows a configured key to opt the repo into hosted embeddings', async () => {
    createLatDir();
    getLlmKey.mockReturnValue('sk-test');
    selectMenu.mockResolvedValue('remote');
    setInteractive(true);

    await initCmd(root);

    expect(selectMenu).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ value: 'local' }),
        expect.objectContaining({ value: 'remote' }),
      ]),
      'Embedding backend',
      0,
    );
    expect(setRepoEmbedding).toHaveBeenCalledWith(latDir(), null);
  });

  // @lat: [[init#Embedding setup#Backend mismatch offers reindexing]]
  it('offers and runs a local reindex for an existing remote index', async () => {
    createLatDir();
    mockStoredModel('openai:1536');
    selectMenu.mockResolvedValue('now');
    setInteractive(true);

    await initCmd(root);

    expect(selectMenu).toHaveBeenCalledWith(
      expect.any(Array),
      'Rebuild the existing index with local embeddings?',
      0,
    );
    expect(reindexCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        latDir: latDir(),
        projectRoot: root,
        mode: 'cli',
      }),
      { local: true },
    );
  });

  // @lat: [[init#Embedding setup#Current setup preserves explicit backend choice]]
  it('does not overwrite the backend choice on a current re-run', () => {
    createLatDir();
    writeInitMeta(latDir(), {});
    writeRepoEmbedding('local');

    const result = runInit();

    expectSuccess(result);
    expect(readRepoEmbedding()).toBe('local');
  });

  // @lat: [[init#Embedding setup#Hosted re-run defaults to hosted]]
  it('defaults an interactive hosted re-run to its existing backend', async () => {
    createLatDir();
    writeInitMeta(latDir(), {});
    mockStoredModel('openai:1536');
    getLlmKey.mockReturnValue('sk-test');
    selectMenu.mockResolvedValue('remote');
    setInteractive(true);

    await initCmd(root);

    expect(selectMenu).toHaveBeenCalledWith(
      expect.any(Array),
      'Embedding backend',
      1,
    );
    expect(setRepoEmbedding).toHaveBeenCalledWith(latDir(), null);
    expect(reindexCommand).not.toHaveBeenCalled();
  });

  // @lat: [[init#Embedding setup#Non-interactive re-run does not choose]]
  it('does not prompt or mutate a current hosted repo without a TTY', () => {
    createLatDir();
    writeInitMeta(latDir(), {});
    seedStoredModel('openai:1536');

    const result = runInit('sk-test');

    expectSuccess(result);
    expect(result.stdout).not.toContain('Embedding backend');
    expect(readRepoEmbedding()).toBeUndefined();
  });

  // @lat: [[init#Embedding setup#Outdated re-run keeps a working hosted index]]
  it('leaves an outdated hosted repo on its existing backend', () => {
    writeOutdatedInitMeta();
    seedStoredModel('openai:1536');

    const result = runInit('sk-test');

    expectSuccess(result);
    expect(readRepoEmbedding()).toBeUndefined();
    expect(result.stdout).not.toContain('lat reindex --local');
  });

  // @lat: [[init#Embedding setup#Outdated hosted provider mismatch defaults local]]
  it('defaults an outdated hosted repo to local when its key provider changed', () => {
    writeOutdatedInitMeta();
    seedStoredModel('openai:1536');

    const result = runInit('vck_test');

    expectSuccess(result);
    expect(readRepoEmbedding()).toBe('local');
    expect(result.stdout).toContain('lat reindex --local');
  });

  // @lat: [[init#Embedding setup#Hosted provider mismatch offers reindexing]]
  it('prints a remote reindex command when the hosted provider changed', () => {
    createLatDir();
    writeInitMeta(latDir(), {});
    seedStoredModel('openai:1536');

    const result = runInit('vck_test');

    expectSuccess(result);
    expect(result.stdout).toContain('lat reindex --remote');
    expect(readRepoEmbedding()).toBeUndefined();
  });

  // @lat: [[init#Embedding setup#Non-interactive mismatch prints command]]
  it('prints the reindex command for a non-interactive mismatch', () => {
    createLatDir();
    writeInitMeta(latDir(), {});
    seedStoredModel('openai:1536');
    writeRepoEmbedding('local');

    const result = runInit();

    expectSuccess(result);
    expect(result.stdout).toContain('lat reindex --local');
    expect(readRepoEmbedding()).toBe('local');
  });
});
