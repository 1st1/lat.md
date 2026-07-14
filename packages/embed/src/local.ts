/**
 * Local embedding backend: the candle → WASM MiniLM engine, driven by a
 * {@link ModelManifest} from a weights package such as `@lat.md/embed-minilm-fp16`.
 */

import { readFileSync } from 'node:fs';
import type { Embedder, ModelManifest } from './index.js';
import { loadWasmEngine } from './wasm-loader.js';

// Embed one text at a time. The single-threaded WASM engine has no cross-item
// batching speedup, and `BatchLongest` padding within a batch makes every item
// pay the longest item's token length — so batching is strictly slower when
// lengths vary (measured ~2× on real docs), besides risking an out-of-memory
// trap on large batches. One-at-a-time is fastest here, uses minimal memory,
// and yields the finest progress granularity.
const CHUNK = 1;

export async function createLocalEmbedder(
  model: ModelManifest,
): Promise<Embedder> {
  const { Embedder: WasmEmbedder } = loadWasmEngine();
  const weights = new Uint8Array(readFileSync(model.weightsPath));
  const tokenizer = new Uint8Array(readFileSync(model.tokenizerPath));
  const config = new Uint8Array(readFileSync(model.configPath));
  const engine = new WasmEmbedder(weights, tokenizer, config, model.maxTokens);

  return {
    // `local:` prefix marks the backend (not baked into the model id) so callers
    // can tell local vs remote from the name alone.
    name: `local:${model.id}`,
    dimensions: engine.dimensions(),
    embed: async (texts, onProgress) => {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += CHUNK) {
        out.push(...engine.embed(texts.slice(i, i + CHUNK)));
        onProgress?.(Math.min(i + CHUNK, texts.length), texts.length);
        // The WASM forward pass is synchronous and blocks the event loop; yield
        // between chunks so the progress line repaints and signals (Ctrl-C) fire.
        if (i + CHUNK < texts.length) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      return out;
    },
  };
}
