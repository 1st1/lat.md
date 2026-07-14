import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import xdg from '@folder/xdg';

// ── XDG config directory ────────────────────────────────────────────

export function getConfigDir(): string {
  return join(xdg().config, 'lat');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

// ── Config read/write ───────────────────────────────────────────────

export type LatConfig = {
  llm_key?: string;
  /**
   * Per-repo embedding backend preference, keyed by absolute lat.md dir. Durable
   * (survives deletion of the regenerable `.cache`), so a repo explicitly
   * switched to local stays local even after a cache wipe or fresh clone.
   */
  repos?: Record<string, { embedding?: 'local' }>;
};

export function readConfig(): LatConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(
      `Error: failed to parse config ${configPath}: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }
}

export function writeConfig(config: LatConfig): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n');
}

// ── Per-repo embedding backend preference ───────────────────────────

/** Durable per-repo backend choice, or undefined if none recorded. */
export function getRepoEmbedding(latDir: string): 'local' | undefined {
  return readConfig().repos?.[resolve(latDir)]?.embedding;
}

/** Record (or clear, with `null`) the durable per-repo backend choice. */
export function setRepoEmbedding(
  latDir: string,
  embedding: 'local' | null,
): void {
  const key = resolve(latDir);
  const config = readConfig();
  const repos = config.repos ?? {};
  if (embedding === null) delete repos[key];
  else repos[key] = { embedding };
  config.repos = repos;
  writeConfig(config);
}

// ── Centralized LLM key resolution ─────────────────────────────────

/**
 * Returns the LLM key from (in priority order):
 * 1. LAT_LLM_KEY environment variable
 * 2. LAT_LLM_KEY_FILE — path to a file containing the key
 * 3. LAT_LLM_KEY_HELPER — shell command that prints the key
 * 4. llm_key field in ~/.config/lat/config.json
 *
 * Returns undefined if none is set.
 */
export function getLlmKey(): string | undefined {
  const envKey = process.env.LAT_LLM_KEY;
  if (envKey) return envKey;

  const file = process.env.LAT_LLM_KEY_FILE;
  if (file) {
    const content = readFileSync(file, 'utf-8').trim();
    if (!content) {
      throw new Error(`LAT_LLM_KEY_FILE (${file}) is empty.`);
    }
    return content;
  }

  const helper = process.env.LAT_LLM_KEY_HELPER;
  if (helper) {
    const result = execSync(helper, {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    if (!result) {
      throw new Error('LAT_LLM_KEY_HELPER command returned an empty string.');
    }
    return result;
  }

  const config = readConfig();
  if (config.llm_key) return config.llm_key;

  return undefined;
}
