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

export type LocalModelSize = 'small' | 'medium' | 'large';

type LocalModelEntry = {
  model: string;
  dimensions: number;
  approxMb: number;
};

const LOCAL_MODELS: Record<LocalModelSize, LocalModelEntry> = {
  small: { model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, approxMb: 45 },
  medium: { model: 'Xenova/bge-base-en-v1.5', dimensions: 768, approxMb: 130 },
  large: { model: 'Xenova/bge-large-en-v1.5', dimensions: 1024, approxMb: 330 },
};

const VALID_SIZES = Object.keys(LOCAL_MODELS).join(', ');

function parseModelSize(): LocalModelSize {
  const raw = process.env.LAT_LOCAL_MODEL_SIZE;
  if (!raw) return 'small';
  const normalized = raw.toLowerCase().trim() as LocalModelSize;
  if (!(normalized in LOCAL_MODELS)) {
    throw new Error(
      `Invalid LAT_LOCAL_MODEL_SIZE "${raw}". Valid sizes: ${VALID_SIZES}.`,
    );
  }
  return normalized;
}

export function getLocalProvider(): LocalProvider {
  const size = parseModelSize();
  const entry = LOCAL_MODELS[size];
  return {
    kind: 'local',
    name: 'local',
    model: entry.model,
    dimensions: entry.dimensions,
  };
}

const openai: ApiProvider = {
  kind: 'api',
  name: 'openai',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

const vercel: ApiProvider = {
  kind: 'api',
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
  if (!key) return getLocalProvider();

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
  if (key.startsWith('vck_')) return vercel;
  if (key.startsWith('sk-')) return openai;
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...). Omit LAT_LLM_KEY to use local embeddings.`,
  );
}
