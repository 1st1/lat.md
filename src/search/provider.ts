export type EmbeddingProvider = {
  name: string;
  apiBase: string;
  model: string;
  dimensions: number;
  headers: (key: string) => Record<string, string>;
};

// Known dimensions for common Ollama embedding models.
// Override with LAT_OLLAMA_DIMENSIONS for unlisted models.
const OLLAMA_KNOWN_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'snowflake-arctic-embed': 1024,
  'bge-large': 1024,
  'bge-base': 768,
  'bge-small': 384,
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
  if (key.startsWith('ollama:')) {
    const model = key.slice('ollama:'.length).trim();
    if (!model)
      throw new Error(
        'ollama: key must include a model name, e.g. LAT_LLM_KEY=ollama:nomic-embed-text',
      );
    const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
    const dimOverride = process.env.LAT_OLLAMA_DIMENSIONS;
    const dimensions = dimOverride
      ? parseInt(dimOverride, 10)
      : (OLLAMA_KNOWN_DIMENSIONS[model] ?? 768);
    return {
      name: 'ollama',
      apiBase: `${host}/v1`,
      model,
      dimensions,
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
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...), Ollama (ollama:<model>).`,
  );
}
