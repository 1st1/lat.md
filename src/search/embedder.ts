import {
  createEmbedder,
  EmbeddingAuthError,
  type Embedder,
} from '@lat.md/embed';
import minilm from '@lat.md/embed-minilm-fp16';
import { getLlmKey } from '../config.js';

export type { Embedder };
export { EmbeddingAuthError };

/** `meta.embedding_model` value for an embedder, e.g. `local:minilm-l6-v2:384`. */
export function modelKey(embedder: Embedder): string {
  return `${embedder.name}:${embedder.dimensions}`;
}

/** Thrown when the stored index can't be served by the current environment and
 *  a `lat reindex` is required (wrong/absent key, or model mismatch). */
export class ReindexRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReindexRequiredError';
  }
}

/** Build an embedder from the environment (key → remote, else local). Used for
 *  a fresh index and by `lat reindex` when re-deciding the backend. */
export async function embedderFromEnv(): Promise<Embedder> {
  const key = getLlmKey();
  return key ? createEmbedder({ key }) : createEmbedder({ model: minilm });
}

/** Local (offline) embedder, ignoring any configured key. */
export function localEmbedder(): Promise<Embedder> {
  return createEmbedder({ model: minilm });
}

/**
 * Resolve the embedder `lat search` must use, given the index's recorded model.
 * The stored model is authoritative — the env var never silently flips the
 * backend. A local index ignores the key; a remote index requires a matching
 * key (used to embed every query) or throws {@link ReindexRequiredError}.
 */
export async function embedderForIndex(
  storedModel: string | null,
): Promise<Embedder> {
  if (storedModel === null) {
    // Fresh index — decide from the environment and record it later.
    return embedderFromEnv();
  }

  if (storedModel.startsWith('local:')) {
    return localEmbedder(); // ignores LAT_LLM_KEY entirely
  }

  // Remote-pinned index: needs a key that resolves to the same model.
  const key = getLlmKey();
  if (!key) {
    throw new ReindexRequiredError(
      `This index was built with '${storedModel}', but no LAT_LLM_KEY is set. ` +
        `Run 'lat reindex' to switch to the local model or restore the key.`,
    );
  }
  const embedder = await createEmbedder({ key });
  if (modelKey(embedder) !== storedModel) {
    throw new ReindexRequiredError(
      `This index was built with '${storedModel}', but the current key resolves ` +
        `to '${modelKey(embedder)}'. Run 'lat reindex' to rebuild.`,
    );
  }
  return embedder;
}
