import { createEmbedder, type Embedder } from '@lat.md/embed';
import minilm from '@lat.md/embed-minilm-fp16';
import { getLlmKey } from '../config.js';

export type { Embedder };

/**
 * Resolve the active embedder. An API key (env/config) selects the hosted
 * backend; otherwise the bundled local MiniLM model is used — no key required,
 * fully offline. All embedding generation lives in `@lat.md/embed`.
 */
export async function getEmbedder(): Promise<Embedder> {
  const key = getLlmKey();
  return key ? createEmbedder({ key }) : createEmbedder({ model: minilm });
}
