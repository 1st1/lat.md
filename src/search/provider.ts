import type { LatConfig } from '../config.js';

export type EmbeddingProvider = {
  name: string;
  apiBase: string;
  model: string;
  dimensions: number;
  headers: (key?: string) => Record<string, string>;
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

function customProvider(config: LatConfig): EmbeddingProvider | null {
  const base = process.env.LAT_LLM_BASE ?? config.llm_base;
  if (!base) return null;
  return {
    name: 'custom',
    apiBase: base,
    model: process.env.LAT_LLM_MODEL ?? config.llm_model ?? 'default',
    dimensions:
      process.env.LAT_LLM_DIMENSIONS != null
        ? Number(process.env.LAT_LLM_DIMENSIONS)
        : (config.llm_dimensions ?? 1536),
    headers: (k) => {
      const h: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (k) h['Authorization'] = `Bearer ${k}`;
      return h;
    },
  };
}

export function detectProvider(
  key: string | undefined,
  config: LatConfig = {},
): EmbeddingProvider {
  if (key?.startsWith('REPLAY_LAT_LLM_KEY::')) {
    const replayUrl = key.slice('REPLAY_LAT_LLM_KEY::'.length);
    return {
      name: 'replay',
      apiBase: replayUrl,
      model: 'replay',
      dimensions: 1536,
      headers: () => ({ 'Content-Type': 'application/json' }),
    };
  }

  const custom = customProvider(config);
  if (custom) return custom;

  if (!key) {
    throw new Error('No API key configured.');
  }
  if (key.startsWith('sk-ant-')) {
    throw new Error(
      "Anthropic doesn't offer an embedding model. Set LAT_LLM_KEY to an OpenAI (sk-...) or Vercel AI Gateway (vck_...) key.",
    );
  }
  if (key.startsWith('vck_')) return vercel;
  if (key.startsWith('sk-')) return openai;
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...), or set LAT_LLM_BASE for a custom endpoint.`,
  );
}
