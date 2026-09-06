/**
 * Remote embedding backend: OpenAI-compatible `/v1/embeddings` over `fetch`.
 * Moved here from lat.md so all embedding generation lives in one place.
 */

import type { Embedder } from './index.js';
import { getEncoding } from 'js-tiktoken';

let tokenizer: ReturnType<typeof getEncoding> | undefined;
const encoding = () => (tokenizer ??= getEncoding('cl100k_base'));
const MAX_INPUT_TOKENS = 8191;
const MAX_BATCH_TOKENS = 250000;

export type RemoteProvider = {
  name: string;
  apiBase: string;
  model: string;
  dimensions: number;
  headers: (key: string) => Record<string, string>;
};

/** Thrown when the provider rejects the credential (HTTP 401/403). */
export class EmbeddingAuthError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`Embedding API rejected the key (${status}): ${body.slice(0, 200)}`);
    this.name = 'EmbeddingAuthError';
    this.status = status;
  }
}

const MAX_BATCH = 2048;

const openai: RemoteProvider = {
  name: 'openai',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

const vercel: RemoteProvider = {
  name: 'vercel',
  apiBase: 'https://ai-gateway.vercel.sh/v1',
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

/** Map an API key to a provider by prefix (mirrors the previous lat.md logic). */
export function detectProvider(key: string): RemoteProvider {
  if (key.startsWith('REPLAY_LAT_LLM_KEY::')) {
    const replayUrl = key.slice('REPLAY_LAT_LLM_KEY::'.length);
    return {
      name: 'replay',
      apiBase: replayUrl,
      model: 'replay',
      dimensions: 1536,
      headers: () => ({ 'Content-Type': 'application/json' }),
    };
  }
  if (key.startsWith('sk-ant-')) {
    throw new Error(
      "Anthropic doesn't offer an embedding model. Set LAT_LLM_KEY to an OpenAI (sk-...) or Vercel AI Gateway (vck_...) key.",
    );
  }
  if (key.startsWith('vck_')) return vercel;
  if (key.startsWith('sk-')) return openai;
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...).`,
  );
}

async function embedViaFetch(
  texts: string[],
  provider: RemoteProvider,
  key: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; ) {
    const batch: string[] = [];
    let tokens = 0;
    while (i < texts.length && batch.length < MAX_BATCH) {
      const count = encoding().encode(texts[i], [], []).length;
      if (count > MAX_INPUT_TOKENS)
        throw new Error('Embedding input exceeds model token limit');
      if (batch.length && tokens + count > MAX_BATCH_TOKENS) break;
      tokens += count;
      batch.push(texts[i++]);
    }
    const resp = await fetch(`${provider.apiBase}/embeddings`, {
      method: 'POST',
      headers: provider.headers(key),
      body: JSON.stringify({ model: provider.model, input: batch }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      if (resp.status === 401 || resp.status === 403) {
        throw new EmbeddingAuthError(resp.status, body);
      }
      throw new Error(
        `Embedding API error (${resp.status}): ${body.slice(0, 200)}`,
      );
    }
    const json = (await resp.json()) as {
      data: { embedding: number[]; index: number }[];
    };
    const sorted = json.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) results.push(item.embedding);
    onProgress?.(i, texts.length);
  }
  return results;
}

export function createRemoteEmbedder(key: string): Embedder {
  const provider = detectProvider(key);
  return {
    name: provider.name,
    dimensions: provider.dimensions,
    maxInputTokens: MAX_INPUT_TOKENS,
    tokenizerFingerprint: 'cl100k_base:v1',
    countTokens: (text) => encoding().encode(text, [], []).length,
    embed: (texts, onProgress) =>
      texts.length
        ? embedViaFetch(texts, provider, key, onProgress)
        : Promise.resolve([]),
  };
}
