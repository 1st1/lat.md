import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getLlmBaseUrl,
  getLlmProvider,
  getLlmModel,
  getLlmAnthropicVersion,
  getLlmProviderOptions,
} from '../src/config.js';

const ENV_KEYS = [
  'LAT_LLM_BASE_URL',
  'LAT_LLM_PROVIDER',
  'LAT_LLM_MODEL',
  'LAT_LLM_ANTHROPIC_VERSION',
] as const;

describe('config custom-endpoint resolvers', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // @lat: [[search#Configuration Resolution#Resolve from env vars]]
  it('resolves each field from its env var', () => {
    process.env.LAT_LLM_BASE_URL = 'http://localhost:11434/v1';
    process.env.LAT_LLM_PROVIDER = 'anthropic';
    process.env.LAT_LLM_MODEL = 'nomic-embed-text';
    process.env.LAT_LLM_ANTHROPIC_VERSION = '2024-01-01';

    expect(getLlmBaseUrl()).toBe('http://localhost:11434/v1');
    expect(getLlmProvider()).toBe('anthropic');
    expect(getLlmModel()).toBe('nomic-embed-text');
    expect(getLlmAnthropicVersion()).toBe('2024-01-01');
  });

  // @lat: [[search#Configuration Resolution#Undefined when unset]]
  it('returns undefined when no env var or config file value is set', () => {
    expect(getLlmBaseUrl()).toBeUndefined();
    expect(getLlmProvider()).toBeUndefined();
    expect(getLlmModel()).toBeUndefined();
    expect(getLlmAnthropicVersion()).toBeUndefined();
  });

  // @lat: [[search#Configuration Resolution#Bundles into provider options]]
  it('getLlmProviderOptions bundles all four resolvers', () => {
    process.env.LAT_LLM_BASE_URL = 'https://example.com/v1';
    process.env.LAT_LLM_PROVIDER = 'openai';
    process.env.LAT_LLM_MODEL = 'text-embedding-3-large';

    expect(getLlmProviderOptions()).toEqual({
      baseUrl: 'https://example.com/v1',
      providerName: 'openai',
      model: 'text-embedding-3-large',
      anthropicVersion: undefined,
    });
  });
});
