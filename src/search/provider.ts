import { getLocalDimensions } from './local.js';

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
};

export type EmbeddingProvider = ApiProvider | LocalProvider;

const DEFAULT_LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';

let _localDims: Promise<number> | null = null;
let _localDimsModel: string | null = null;

export function getLocalProvider(): LocalProvider {
  const model = process.env.LAT_LOCAL_MODEL || DEFAULT_LOCAL_MODEL;
  return { kind: 'local', name: 'local', model };
}

export async function getDimensions(
  provider: EmbeddingProvider,
): Promise<number> {
  if (provider.kind === 'api') return provider.dimensions;
  // Cache the promise so concurrent callers share a single load.
  if (!_localDims || _localDimsModel !== provider.model) {
    _localDimsModel = provider.model;
    _localDims = getLocalDimensions(provider.model);
  }
  return _localDims;
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
