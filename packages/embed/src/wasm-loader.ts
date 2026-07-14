/**
 * Loads the wasm-bindgen `nodejs`-target engine glue. That glue is CommonJS
 * (`module.exports`); this package is ESM, so we bridge via `createRequire`
 * (the same pattern lat.md uses for tree-sitter WASM in `src/source-parser.ts`).
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface WasmEngine {
  embed(texts: string[]): number[][];
  dimensions(): number;
  free(): void;
}

export interface WasmModule {
  Embedder: new (
    weights: Uint8Array,
    tokenizer: Uint8Array,
    config: Uint8Array,
    maxTokens: number,
  ) => WasmEngine;
}

let cached: WasmModule | null = null;

export function loadWasmEngine(): WasmModule {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url)); // dist/
  cached = require(join(here, 'engine.cjs')) as WasmModule;
  return cached;
}
