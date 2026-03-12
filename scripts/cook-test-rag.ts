/**
 * Cook replay data for the RAG test case.
 *
 * Runs the search test in capture mode — proxies to the real embedding API
 * (via LAT_LLM_KEY) and records all vectors to tests/cases/rag/replay-data/.
 *
 * Usage: pnpm cook-test-rag  (requires LAT_LLM_KEY, LAT_LLM_KEY_FILE, or LAT_LLM_KEY_HELPER)
 */

import { execSync } from 'node:child_process';
import { resolveApiKey } from '../src/resolve-key.js';

try {
  // Resolve once up front so capture mode has a direct key value.
  const key = resolveApiKey();
  process.env.LAT_LLM_KEY = key;
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

execSync('pnpm test -- tests/search.test.ts', {
  stdio: 'inherit',
  env: { ...process.env, _LAT_TEST_CAPTURE_EMBEDDINGS: '1' },
});
