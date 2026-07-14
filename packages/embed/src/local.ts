/**
 * Local embedding backend: the candle → WASM MiniLM engine, driven by a
 * {@link ModelManifest} from a weights package such as `@lat.md/embed-minilm-fp16`.
 */

import { readFileSync } from 'node:fs';
import type { Embedder, ModelManifest } from './index.js';
import { loadWasmEngine } from './wasm-loader.js';

// Cap the per-call batch so the padded [batch, seqLen, hidden] activations stay
// within WASM's linear memory. Embedding hundreds of sections at once otherwise
// overflows and traps (RuntimeError: unreachable). Throughput is unaffected —
// the engine has no cross-item batching speedup anyway.
const CHUNK = 32;

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
    embed: async (texts) => {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += CHUNK) {
        out.push(...engine.embed(texts.slice(i, i + CHUNK)));
      }
      return out;
    },
  };
}
