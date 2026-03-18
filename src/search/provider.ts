export type ApiProvider = {
  kind: 'api';
  name: string;
  apiBase: string;
  model: string;
  dimensions: number;
  headers: (key: string) => Record<string, string>;
};

export type LocalProvider = {
  kind: 'local';
  name: 'local';
  model: string;
  dimensions: number;
};

export type EmbeddingProvider = ApiProvider | LocalProvider;

export const localProvider: LocalProvider = {
  kind: 'local',
  name: 'local',
  model: 'Xenova/all-MiniLM-L6-v2',
  dimensions: 384,
};

const openai: Omit<ApiProvider, 'kind'> = {
  name: 'openai',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

const vercel: Omit<ApiProvider, 'kind'> = {
  name: 'vercel',
  apiBase: 'https://ai-gateway.vercel.sh/v1',
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

export function detectProvider(key?: string): EmbeddingProvider {
  if (!key) return localProvider;

  if (key.startsWith('REPLAY_LAT_LLM_KEY::')) {
    const replayUrl = key.slice('REPLAY_LAT_LLM_KEY::'.length);
    return {
      kind: 'api',
      name: 'replay',
      apiBase: replayUrl,
      model: 'replay',
      dimensions: 1536,
      headers: () => ({ 'Content-Type': 'application/json' }),
    };
  }
  if (key.startsWith('sk-ant-')) {
    throw new Error(
      "Anthropic doesn't offer an embedding model. Set LAT_LLM_KEY to an OpenAI (sk-...) or Vercel AI Gateway (vck_...) key, or omit it to use local embeddings.",
    );
  }
  if (key.startsWith('vck_')) return { kind: 'api', ...vercel };
  if (key.startsWith('sk-')) return { kind: 'api', ...openai };
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...). Omit LAT_LLM_KEY to use local embeddings.`,
  );
}
