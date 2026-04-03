export type EmbeddingProvider = {
  name: string;
  apiBase: string;
  model: string;
  dimensions: number;
  headers: (key: string) => Record<string, string>;
};

const openai: EmbeddingProvider = {
  name: 'openai',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

const vercel: EmbeddingProvider = {
  name: 'vercel',
  apiBase: 'https://ai-gateway.vercel.sh/v1',
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

const gemini: EmbeddingProvider = {
  name: 'gemini',
  apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-embedding-001',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

/**
 * Build a custom provider from LAT_LLM_ENDPOINT + optional LAT_LLM_MODEL.
 * The endpoint must be OpenAI-compatible (POST /embeddings).
 */
export function customProvider(
  endpoint: string,
  model?: string,
): EmbeddingProvider {
  return {
    name: 'custom',
    apiBase: endpoint.replace(/\/+$/, ''),
    model: model || 'text-embedding-3-small',
    dimensions: 1536,
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
  };
}

export function detectProvider(key: string): EmbeddingProvider {
  // Custom endpoint takes highest priority
  const endpoint = process.env.LAT_LLM_ENDPOINT;
  if (endpoint) {
    return customProvider(endpoint, process.env.LAT_LLM_MODEL);
  }

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
  if (key.startsWith('AIza')) return gemini;
  if (key.startsWith('vck_')) return vercel;
  if (key.startsWith('sk-')) return openai;
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...), Gemini (AIza...). ` +
      `Or set LAT_LLM_ENDPOINT for any OpenAI-compatible server.`,
  );
}
