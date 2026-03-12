import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Resolve the LLM API key from, in priority order:
 *   1. LAT_LLM_KEY          — direct value
 *   2. LAT_LLM_KEY_FILE     — path to a file containing the key
 *   3. LAT_LLM_KEY_HELPER   — shell command that prints the key
 */
export function resolveApiKey(): string {
  const key = process.env.LAT_LLM_KEY;
  if (key) return key;

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

  throw new Error(
    'LAT_LLM_KEY is not set. Provide the key via LAT_LLM_KEY, LAT_LLM_KEY_FILE, or LAT_LLM_KEY_HELPER.',
  );
}
