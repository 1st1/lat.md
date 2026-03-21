import type { EmbeddingProvider, ApiProvider } from './provider.js';

const API_MAX_BATCH = 2048;
// Local models are CPU-bound; 32 keeps peak memory reasonable on laptops.
const LOCAL_BATCH = 32;

// Module-level pipeline cache — avoids reloading the model on each call.
// Stores the Promise so concurrent callers share a single load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipelinePromise: Promise<any> | null = null;
let _pipelineModel: string | null = null;

async function getLocalPipeline(model: string) {
  if (_pipelinePromise && _pipelineModel === model) return _pipelinePromise;
  if (!_pipelinePromise) {
    process.stderr.write(
      'Loading local embedding model (first run downloads ~45 MB)...\n',
    );
  }
  _pipelineModel = model;
  const { pipeline } = await import('@huggingface/transformers');
  // fp16 balances download size (~45 MB vs ~90 MB for fp32) against
  // embedding quality for nearest-neighbor retrieval over short text chunks.
  _pipelinePromise = pipeline('feature-extraction', model, {
    dtype: 'fp16',
  });
  return _pipelinePromise;
}

async function embedLocal(texts: string[], model: string): Promise<number[][]> {
  const extractor = await getLocalPipeline(model);
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += LOCAL_BATCH) {
    const batch = texts.slice(i, i + LOCAL_BATCH);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    results.push(...output.tolist());
  }
  return results;
}

async function embedApi(
  texts: string[],
  provider: ApiProvider,
  key: string,
): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += API_MAX_BATCH) {
    const batch = texts.slice(i, i + API_MAX_BATCH);
    const resp = await fetch(`${provider.apiBase}/embeddings`, {
      method: 'POST',
      headers: provider.headers(key),
      body: JSON.stringify({
        model: provider.model,
        input: batch,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Embedding API error (${resp.status}): ${body.slice(0, 200)}`,
      );
    }

    const json = (await resp.json()) as {
      data: { embedding: number[]; index: number }[];
    };
    const sorted = json.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      results.push(item.embedding);
    }
  }
  return results;
}

/**
 * Resolve the embedding dimensions for a provider. API providers declare
 * dimensions statically; local providers probe the model with a tiny input.
 */
export async function getDimensions(provider: EmbeddingProvider): Promise<number> {
  if (provider.kind === 'api') return provider.dimensions;
  const extractor = await getLocalPipeline(provider.model);
  const output = await extractor(['dim probe'], { pooling: 'mean', normalize: true });
  return output.dims[output.dims.length - 1];
}

export async function embed(
  texts: string[],
  provider: EmbeddingProvider,
  key?: string,
): Promise<number[][]> {
  if (provider.kind === 'local') {
    return embedLocal(texts, provider.model);
  }
  if (!key) {
    throw new Error('API embedding provider requires a key');
  }
  return embedApi(texts, provider, key);
}
