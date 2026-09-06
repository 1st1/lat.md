/**
 * Loads the wasm-bindgen `nodejs`-target engine glue. That glue is CommonJS
 * (`module.exports`); this package is ESM, so we bridge via `createRequire`
 * (the same pattern lat.md uses for tree-sitter WASM in `src/source-parser.ts`).
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export interface WasmEngine {
  embed(texts: string[]): number[][];
  dimensions(): number;
  count_tokens(text: string): number;
  free(): void;
}

export interface WasmModule {
  __initialize(bytes: Uint8Array): void;
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
  const engine = require('./engine.cjs') as WasmModule;
  engine.__initialize(
    new Uint8Array(readFileSync(new URL('./engine_bg.wasm', import.meta.url))),
  );
  cached = engine;
  return cached;
}
