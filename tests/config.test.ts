import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRepoEmbedding,
  readConfig,
  setRepoEmbedding,
  writeConfig,
} from '../src/config.js';

describe('configuration persistence', () => {
  let configRoot: string;
  let previousConfigHome: string | undefined;

  beforeEach(() => {
    configRoot = mkdtempSync(join(tmpdir(), 'lat-config-'));
    previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
  });

  afterEach(() => {
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    rmSync(configRoot, { recursive: true, force: true });
  });

  // @lat: [[config#Configuration#Repository preferences#Persists local preference]]
  it('round-trips a repo preference without losing a manual key', () => {
    const latDir = join(configRoot, 'example-project', 'lat.md');
    writeConfig({ llm_key: 'sk-manual' });

    setRepoEmbedding(latDir, 'local');

    expect(getRepoEmbedding(latDir)).toBe('local');
    expect(readConfig()).toEqual({
      llm_key: 'sk-manual',
      repos: { [latDir]: { embedding: 'local' } },
    });
  });
});
