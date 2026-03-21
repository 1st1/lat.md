import type { ApiProvider, EmbeddingProvider } from './provider.js';
import { embedLocal } from './local.js';

const API_MAX_BATCH = 2048;

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
  if (!key) {
    throw new Error('API embedding provider requires a key');
  }
  return embedApi(texts, provider, key);
}
