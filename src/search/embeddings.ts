import type { EmbeddingProvider } from './provider.js';

// Max inputs per request — the embedding APIs also cap array length.
const MAX_BATCH = 2048;
// Stay comfortably under the embedding APIs' 300k-tokens-per-request cap.
const MAX_BATCH_TOKENS = 250_000;

// Rough token estimate: ~4 chars/token for English prose + code.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Split texts into batches bounded by BOTH input count and estimated tokens,
// so a large corpus doesn't exceed the per-request token limit. Order is
// preserved, so callers can map results back positionally.
export function planBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);
    if (
      batch.length > 0 &&
      (batch.length >= MAX_BATCH || batchTokens + tokens > MAX_BATCH_TOKENS)
    ) {
      batches.push(batch);
      batch = [];
      batchTokens = 0;
    }
    batch.push(text);
    batchTokens += tokens;
  }
  if (batch.length > 0) batches.push(batch);

  return batches;
}

export async function embed(
  texts: string[],
  provider: EmbeddingProvider,
  key: string,
): Promise<number[][]> {
  const results: number[][] = [];

  for (const batch of planBatches(texts)) {
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
