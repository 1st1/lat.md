/**
 * @lat.md/embed — the single home for embedding generation used by lat.md.
 *
 * Two backends behind one {@link Embedder} interface:
 *   - local:  candle → WASM MiniLM engine, driven by a {@link ModelManifest}
 *   - remote: OpenAI-compatible HTTP API (OpenAI / Vercel AI Gateway / replay)
 *
 * lat.md contains no embedding logic — it resolves config and calls
 * {@link createEmbedder}.
 */

import { createRemoteEmbedder } from './remote.js';
import { createLocalEmbedder } from './local.js';

/** A configured embedder. `embed` returns one vector per input text. */
export interface Embedder {
  /** Stable identifier: 'local:minilm-l6-v2' | 'openai' | 'vercel' | 'replay'. */
  readonly name: string;
  /** Output dimensionality (384 local MiniLM, 1536 hosted OpenAI). */
  readonly dimensions: number;
  /**
   * Embed texts. `onProgress(done, total)` fires as internal batches complete —
   * useful for a progress indicator on the (synchronous, chunked) local backend.
   */
  embed(
    texts: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number[][]>;
}

/** Contract a model-weights package (e.g. `@lat.md/embed-minilm-fp16`) exports. */
export interface ModelManifest {
  /** Stable model id, also used as the {@link Embedder.name}. */
  id: string;
  dimensions: number;
  /** Max input tokens; longer inputs are truncated. */
  maxTokens: number;
  pooling: 'mean';
  normalize: boolean;
  /** Absolute path to the fp16 (or fp32) safetensors weights. */
  weightsPath: string;
  /** Absolute path to `tokenizer.json`. */
  tokenizerPath: string;
  /** Absolute path to the BERT `config.json`. */
  configPath: string;
}

/**
 * Create an embedder. A `key` selects the remote backend (provider detected by
 * key prefix); otherwise `model` selects the local WASM backend. If both are
 * given, the key wins (hosted quality takes precedence).
 */
export async function createEmbedder(cfg: {
  key?: string;
  model?: ModelManifest;
}): Promise<Embedder> {
  if (cfg.key) return createRemoteEmbedder(cfg.key);
  if (cfg.model) return createLocalEmbedder(cfg.model);
  throw new Error('createEmbedder requires either a `key` or a `model`.');
}

export { detectProvider, EmbeddingAuthError } from './remote.js';
export type { RemoteProvider } from './remote.js';
