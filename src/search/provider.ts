export type EmbeddingProvider = {
  name: string;
  apiBase: string;
  model: string;
  /**
   * Vector length for the embedding model. Known statically for the
   * built-in providers; left undefined for custom base URLs or model
   * overrides, in which case `resolveSchema()` probes it at runtime.
   */
  dimensions?: number;
  headers: (key: string) => Record<string, string>;
};

export type ProviderOptions = {
  /** Custom OpenAI/Anthropic-compatible API root (LAT_LLM_BASE_URL). */
  baseUrl?: string;
  /** Request/header format: 'openai' (default) or 'anthropic' (LAT_LLM_PROVIDER). */
  providerName?: string;
  /** Embedding model override (LAT_LLM_MODEL). */
  model?: string;
  /** `anthropic-version` header value, only used when providerName is 'anthropic'. */
  anthropicVersion?: string;
};

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_CUSTOM_MODEL = 'text-embedding-3-small';

function openaiHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function anthropicHeaders(key: string, version: string): Record<string, string> {
  return {
    'x-api-key': key,
    'anthropic-version': version,
    'Content-Type': 'application/json',
  };
}

const openai: EmbeddingProvider = {
  name: 'openai',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  headers: openaiHeaders,
};

const vercel: EmbeddingProvider = {
  name: 'vercel',
  apiBase: 'https://ai-gateway.vercel.sh/v1',
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
  headers: openaiHeaders,
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function detectProvider(
  key: string,
  opts: ProviderOptions = {},
): EmbeddingProvider {
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

  if (opts.providerName === 'anthropic') {
    if (!opts.baseUrl) {
      throw new Error(
        'LAT_LLM_PROVIDER=anthropic requires LAT_LLM_BASE_URL. Anthropic has no built-in embeddings API, so this must point at an Anthropic-compatible embeddings endpoint.',
      );
    }
    if (!opts.model) {
      throw new Error(
        'LAT_LLM_PROVIDER=anthropic requires LAT_LLM_MODEL. Anthropic-compatible embedding services have no universal default model name.',
      );
    }
    const version = opts.anthropicVersion || DEFAULT_ANTHROPIC_VERSION;
    return {
      name: 'anthropic-compatible',
      apiBase: stripTrailingSlash(opts.baseUrl),
      model: opts.model,
      dimensions: undefined,
      headers: (k) => anthropicHeaders(k, version),
    };
  }

  if (opts.providerName && opts.providerName !== 'openai') {
    throw new Error(
      `Unrecognized LAT_LLM_PROVIDER "${opts.providerName}". Supported: openai, anthropic.`,
    );
  }

  if (opts.baseUrl) {
    return {
      name: 'openai-compatible',
      apiBase: stripTrailingSlash(opts.baseUrl),
      model: opts.model || DEFAULT_CUSTOM_MODEL,
      dimensions: undefined,
      headers: openaiHeaders,
    };
  }

  if (key.startsWith('sk-ant-')) {
    throw new Error(
      "Anthropic doesn't offer an embedding model. Set LAT_LLM_KEY to an OpenAI (sk-...) or Vercel AI Gateway (vck_...) key, or configure LAT_LLM_BASE_URL for a custom endpoint.",
    );
  }
  if (key.startsWith('vck_')) {
    return opts.model
      ? { ...vercel, model: opts.model, dimensions: undefined }
      : vercel;
  }
  if (key.startsWith('sk-')) {
    return opts.model
      ? { ...openai, model: opts.model, dimensions: undefined }
      : openai;
  }
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...), or set LAT_LLM_BASE_URL for a custom endpoint.`,
  );
}
