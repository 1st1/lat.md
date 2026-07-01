import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
  llm_base_url?: string;
  llm_provider?: string;
  llm_model?: string;
  llm_anthropic_version?: string;
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

/**
 * Returns a custom OpenAI/Anthropic-compatible embeddings API base URL from
 * (in priority order): LAT_LLM_BASE_URL env var, then `llm_base_url` in the
 * config file. Returns undefined if none is set (built-in providers apply).
 */
export function getLlmBaseUrl(): string | undefined {
  const envVal = process.env.LAT_LLM_BASE_URL;
  if (envVal) return envVal;
  return readConfig().llm_base_url;
}

/**
 * Returns the embedding request format ('openai' or 'anthropic') from (in
 * priority order): LAT_LLM_PROVIDER env var, then `llm_provider` in the
 * config file. Returns undefined if none is set (defaults to 'openai' when
 * LAT_LLM_BASE_URL is set, or is ignored otherwise).
 */
export function getLlmProvider(): string | undefined {
  const envVal = process.env.LAT_LLM_PROVIDER;
  if (envVal) return envVal;
  return readConfig().llm_provider;
}

/**
 * Returns an embedding model override from (in priority order):
 * LAT_LLM_MODEL env var, then `llm_model` in the config file. Returns
 * undefined if none is set (the provider's default model applies).
 */
export function getLlmModel(): string | undefined {
  const envVal = process.env.LAT_LLM_MODEL;
  if (envVal) return envVal;
  return readConfig().llm_model;
}

/**
 * Returns the `anthropic-version` header value to send when
 * LAT_LLM_PROVIDER=anthropic, from (in priority order):
 * LAT_LLM_ANTHROPIC_VERSION env var, then `llm_anthropic_version` in the
 * config file. Returns undefined if none is set (a default applies).
 */
export function getLlmAnthropicVersion(): string | undefined {
  const envVal = process.env.LAT_LLM_ANTHROPIC_VERSION;
  if (envVal) return envVal;
  return readConfig().llm_anthropic_version;
}

export type LlmProviderOptions = {
  baseUrl?: string;
  providerName?: string;
  model?: string;
  anthropicVersion?: string;
};

/** Bundles the custom-endpoint resolvers above for `detectProvider()`. */
export function getLlmProviderOptions(): LlmProviderOptions {
  return {
    baseUrl: getLlmBaseUrl(),
    providerName: getLlmProvider(),
    model: getLlmModel(),
    anthropicVersion: getLlmAnthropicVersion(),
  };
}
