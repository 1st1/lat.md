import type {
  EmbeddingProvider,
  ApiProvider,
  LocalProvider,
} from './provider.js';

const API_MAX_BATCH = 2048;
// Local models are CPU-bound; 32 keeps peak memory reasonable on laptops.
const LOCAL_BATCH = 32;

// Module-level pipeline cache — avoids reloading the model on each call.
// Stores the Promise so concurrent callers share a single model load.
// The model name is fixed for the process lifetime (set once from
// LAT_LOCAL_MODEL or the default), so a single cached entry suffices.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipelinePromise: Promise<any> | null = null;
let _pipelineModel: string | null = null;

async function requireTransformers() {
  try {
    return await import('@huggingface/transformers');
  } catch {
    throw new Error(
      'Local embeddings require the @huggingface/transformers package.\n' +
        'Install with: npm install @huggingface/transformers\n' +
        'Or set LAT_LLM_KEY to use an API provider instead.',
    );
  }
}

async function getLocalPipeline(model: string) {
  if (_pipelinePromise && _pipelineModel === model) return _pipelinePromise;
  if (!_pipelinePromise) {
    process.stderr.write(
      'Loading local embedding model (first run downloads ~45 MB)...\n',
    );
  }
  _pipelineModel = model;
  const { pipeline } = await requireTransformers();
  // fp16 balances download size (~45 MB vs ~90 MB for fp32) against
  // embedding quality for nearest-neighbor retrieval over short text chunks.
  _pipelinePromise = pipeline('feature-extraction', model, {
    dtype: 'fp16',
  });
  return _pipelinePromise;
}

/**
 * Read the embedding dimension from a loaded local model's config.
 * The pipeline must be loaded anyway for embedding, so this is just a
 * property access — no inference, no separate config fetch.
 *
 * The config field varies by model architecture:
 *   - hidden_size: BERT, RoBERTa, DistilBERT, ALBERT, Jina, E5, GTE
 *   - n_embd:      GPT-2 family, nomic-embed
 *   - d_model:     T5, BART
 */
export async function getLocalDimensions(model: string): Promise<number> {
  const extractor = await getLocalPipeline(model);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (extractor as any).model?.config;
  const dim: number | undefined = c?.hidden_size ?? c?.n_embd ?? c?.d_model;
  if (typeof dim !== 'number') {
    throw new Error(
      `Cannot determine embedding dimensions for model '${model}': ` +
        `model config has no hidden_size, n_embd, or d_model field.`,
    );
  }
  return dim;
}

async function embedLocal(texts: string[], model: string): Promise<number[][]> {
  const extractor = await getLocalPipeline(model);
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += LOCAL_BATCH) {
    const batch = texts.slice(i, i + LOCAL_BATCH);
    const output = await extractor(batch, {
      pooling: 'mean',
      normalize: true,
    });
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

export async function embed(
  texts: string[],
  provider: LocalProvider,
): Promise<number[][]>;
export async function embed(
  texts: string[],
  provider: ApiProvider,
  key: string,
): Promise<number[][]>;
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
