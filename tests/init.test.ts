import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  INIT_VERSION,
  readInitVersion,
  writeInitMeta,
} from '../src/init-version.js';
import {
  closeDb,
  ensureMeta,
  openDb,
  setStoredModel,
} from '../src/search/db.js';

const {
  getLlmKey,
  getRepoEmbedding,
  setRepoEmbedding,
  selectMenu,
  reindexCommand,
} = vi.hoisted(() => ({
  getLlmKey: vi.fn(),
  getRepoEmbedding: vi.fn(),
  setRepoEmbedding: vi.fn(),
  selectMenu: vi.fn(),
  reindexCommand: vi.fn(),
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

import { initCmd } from '../src/cli/init.js';

describe('lat init embedding setup', () => {
  let root: string;
  let stdinIsTTY: PropertyDescriptor | undefined;

  /** Stamp a setup one version behind, so init treats it as outdated. */
  function writeOutdatedInitMeta(latDir: string): void {
    mkdirSync(join(latDir, '.cache'), { recursive: true });
    writeFileSync(
      join(latDir, '.cache', 'lat_init.json'),
      JSON.stringify({ init_version: INIT_VERSION - 1, file_hashes: {} }),
    );
  }

  async function writeStoredModel(
    latDir: string,
    model: string,
  ): Promise<void> {
    const db = openDb(latDir);
    await ensureMeta(db);
    await setStoredModel(db, model);
    await closeDb(db);
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
    getLlmKey.mockReset();
    getRepoEmbedding.mockReset();
    setRepoEmbedding.mockClear();
    selectMenu.mockReset();
    reindexCommand.mockReset();
    reindexCommand.mockResolvedValue({ output: 'Reindexed.' });
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
  it('pins local embeddings before agent selection on a fresh init', async () => {
    getLlmKey.mockReturnValue('sk-test');

    await initCmd(root);

    expect(selectMenu).not.toHaveBeenCalled();
    expect(setRepoEmbedding).toHaveBeenCalledOnce();
    expect(setRepoEmbedding).toHaveBeenCalledWith(
      resolve(root, 'lat.md'),
      'local',
    );
    expect(readInitVersion(resolve(root, 'lat.md'))).toBe(INIT_VERSION);
  });

  // @lat: [[init#Embedding setup#Configured key asks for a backend]]
  it('allows a configured key to opt the repo into hosted embeddings', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
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
    expect(setRepoEmbedding).toHaveBeenCalledWith(latDir, null);
  });

  // @lat: [[init#Embedding setup#Backend mismatch offers reindexing]]
  it('offers and runs a local reindex for an existing remote index', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    await writeStoredModel(latDir, 'openai:1536');
    selectMenu.mockResolvedValue('now');
    setInteractive(true);

    await initCmd(root);

    expect(selectMenu).toHaveBeenCalledWith(
      expect.any(Array),
      'Rebuild the existing index with local embeddings?',
      0,
    );
    expect(reindexCommand).toHaveBeenCalledWith(
      expect.objectContaining({ latDir, projectRoot: root, mode: 'cli' }),
      { local: true },
    );
  });

  // @lat: [[init#Embedding setup#Current setup preserves explicit backend choice]]
  it('does not overwrite the backend choice on a current re-run', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeInitMeta(latDir, {});
    getRepoEmbedding.mockReturnValue('local');

    await initCmd(root);

    expect(setRepoEmbedding).not.toHaveBeenCalled();
  });

  // @lat: [[init#Embedding setup#Hosted re-run defaults to hosted]]
  it('defaults an interactive hosted re-run to its existing backend', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeInitMeta(latDir, {});
    await writeStoredModel(latDir, 'openai:1536');
    getLlmKey.mockReturnValue('sk-test');
    selectMenu.mockResolvedValue('remote');
    setInteractive(true);

    await initCmd(root);

    expect(selectMenu).toHaveBeenCalledWith(
      expect.any(Array),
      'Embedding backend',
      1,
    );
    expect(setRepoEmbedding).toHaveBeenCalledWith(latDir, null);
    expect(reindexCommand).not.toHaveBeenCalled();
  });

  // @lat: [[init#Embedding setup#Non-interactive re-run does not choose]]
  it('does not prompt or mutate a current hosted repo without a TTY', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeInitMeta(latDir, {});
    await writeStoredModel(latDir, 'openai:1536');
    getLlmKey.mockReturnValue('sk-test');

    await initCmd(root);

    expect(selectMenu).not.toHaveBeenCalled();
    expect(setRepoEmbedding).not.toHaveBeenCalled();
    expect(reindexCommand).not.toHaveBeenCalled();
  });

  // @lat: [[init#Embedding setup#Outdated re-run keeps a working hosted index]]
  it('leaves an outdated hosted repo on its existing backend', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeOutdatedInitMeta(latDir);
    await writeStoredModel(latDir, 'openai:1536');
    getLlmKey.mockReturnValue('sk-test');

    await initCmd(root);

    expect(setRepoEmbedding).not.toHaveBeenCalled();
    expect(reindexCommand).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining('lat reindex --local'),
    );
  });

  // @lat: [[init#Embedding setup#Outdated hosted provider mismatch defaults local]]
  it('defaults an outdated hosted repo to local when its key provider changed', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeOutdatedInitMeta(latDir);
    await writeStoredModel(latDir, 'openai:1536');
    getLlmKey.mockReturnValue('vck_test');

    await initCmd(root);

    expect(setRepoEmbedding).toHaveBeenCalledWith(latDir, 'local');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('lat reindex --local'),
    );
  });

  // @lat: [[init#Embedding setup#Hosted provider mismatch offers reindexing]]
  it('prints a remote reindex command when the hosted provider changed', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeInitMeta(latDir, {});
    await writeStoredModel(latDir, 'openai:1536');
    getLlmKey.mockReturnValue('vck_test');

    await initCmd(root);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('lat reindex --remote'),
    );
    expect(reindexCommand).not.toHaveBeenCalled();
  });

  // @lat: [[init#Embedding setup#Non-interactive mismatch prints command]]
  it('prints the reindex command for a non-interactive mismatch', async () => {
    const latDir = join(root, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeInitMeta(latDir, {});
    await writeStoredModel(latDir, 'openai:1536');
    getRepoEmbedding.mockReturnValue('local');

    await initCmd(root);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('lat reindex --local'),
    );
    expect(reindexCommand).not.toHaveBeenCalled();
  });
});
