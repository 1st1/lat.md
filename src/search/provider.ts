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

function applyEnvOverrides(provider: EmbeddingProvider): EmbeddingProvider {
  const baseUrl = process.env.LAT_LLM_BASE_URL;
  const model = process.env.LAT_LLM_MODEL;
  if (!baseUrl && !model) return provider;
  return {
    ...provider,
    ...(baseUrl ? { apiBase: baseUrl } : {}),
    ...(model ? { model } : {}),
  };
}

export function detectProvider(key: string): EmbeddingProvider {
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
  if (key.startsWith('vck_')) return applyEnvOverrides(vercel);
  if (key.startsWith('sk-')) return applyEnvOverrides(openai);
  // Ollama and other local OpenAI-compatible providers (no auth required)
  if (key === 'ollama' || key === 'local') {
    return {
      name: 'ollama',
      apiBase: process.env.LAT_LLM_BASE_URL ?? 'http://localhost:11434/v1',
      model: process.env.LAT_LLM_MODEL ?? 'nomic-embed-text',
      dimensions: 768,
      headers: () => ({ 'Content-Type': 'application/json' }),
    };
  }
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...), Ollama (ollama).`,
  );
}
