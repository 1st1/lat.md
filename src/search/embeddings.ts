import type { EmbeddingProvider, ApiProvider } from './provider.js';

const API_MAX_BATCH = 2048;
const LOCAL_BATCH = 32;

// Module-level pipeline cache — avoids reloading the model on each call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _localPipeline: any = null;
let _localPipelineModel: string | null = null;

async function getLocalPipeline(model: string) {
  if (_localPipeline && _localPipelineModel === model) return _localPipeline;
  if (!_localPipeline) {
    process.stderr.write(
      'Loading local embedding model (first run downloads ~25 MB)...\n',
    );
  }
  const { pipeline } = await import('@huggingface/transformers');
  _localPipeline = await pipeline('feature-extraction', model, {
    dtype: 'fp32',
    progress_callback: () => {},
  });
  _localPipelineModel = model;
  return _localPipeline;
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

export async function embed(
  texts: string[],
  provider: EmbeddingProvider,
  key?: string,
): Promise<number[][]> {
  if (provider.kind === 'local') {
    return embedLocal(texts, provider.model);
  }
  return embedApi(texts, provider, key!);
}
