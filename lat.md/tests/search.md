---
lat:
  require-code-mention: true
---
# Search

Tests in `tests/search.test.ts` and `tests/config.test.ts`.

## Configuration Resolution

Unit tests in `tests/config.test.ts` for the custom-endpoint resolvers in `src/config.ts`, each mirroring `getLlmKey`'s env-var-then-config-file resolution.

### Resolve from env vars

`getLlmBaseUrl`, `getLlmProvider`, `getLlmModel`, and `getLlmAnthropicVersion` each return their respective `LAT_LLM_*` env var value when set.

### Undefined when unset

Each resolver returns `undefined` when neither its env var nor a config file value is set, so callers can apply their own defaults.

### Bundles into provider options

`getLlmProviderOptions` bundles all four resolvers into a single `{ baseUrl, providerName, model, anthropicVersion }` object for `detectProvider`.

## Provider Detection

Unit tests (always run). Verify `detectProvider` correctly identifies OpenAI (`sk-`), Vercel (`vck_`), rejects Anthropic (`sk-ant-`) with a helpful message, and rejects unknown prefixes.

### Custom OpenAI-compatible endpoint

With `baseUrl` set (and no `providerName`, or `providerName: 'openai'`), `detectProvider` builds a provider pointed at that URL using `Authorization: Bearer` headers and a default model when none is given.

### Anthropic-compatible endpoint

With `providerName: 'anthropic'`, `baseUrl`, and `model` all set, `detectProvider` builds a provider that sends `x-api-key` and `anthropic-version` headers instead of `Authorization: Bearer`, defaulting the version when not overridden.

### Anthropic provider requires base URL and model

`providerName: 'anthropic'` without `baseUrl` throws naming `LAT_LLM_BASE_URL`; without `model` (but with `baseUrl`) throws naming `LAT_LLM_MODEL`. Anthropic has no default embeddings endpoint or model to fall back to.

### Model override clears static dimensions

Passing `model` for a built-in provider (OpenAI or Vercel key prefix) overrides its model name and clears its statically known `dimensions`, since a non-default model may have a different vector size.

## Dimension Resolution

Tests in `tests/schema.test.ts`, exercising `resolveSchema()` against a minimal local embeddings stub. Verifies the vectors DB's `meta` table caching described in [[cli#Storage#Dimension Resolution]].

### Probes and caches an unknown dimension

When a provider has no static `dimensions`, the first call to `resolveSchema()` issues one embedding call to learn the vector length and stores it in the `meta` table.

### Reuses cached dimension on repeat calls

A second `resolveSchema()` call with the same provider signature (`name:apiBase:model`) reuses the cached dimension without issuing another embedding call.

### Detects provider or model changes

When the provider signature differs from the one cached in `meta` from a prior call, `resolveSchema()` reports `configChanged: true` so the caller can drop and rebuild the `sections` table.

## RAG Replay Tests

Functional tests that exercise the full RAG pipeline using a replay server instead of a real embedding API.

The test covers indexing, hashing, vector insert, and KNN search via `tests/rag-replay-server.ts`. Test fixture lives in `tests/cases/rag/lat.md/` with pre-recorded vectors in `tests/cases/rag/replay-data/`.

The replay server has two modes:
- **Replay** (default `pnpm test`): serves cached vectors from binary replay data. Matches requests by SHA-256 of input text.
- **Capture** (`pnpm cook-test-rag`): proxies to real API via `LAT_LLM_KEY`, records all text→vector mappings, flushes binary data to `replay-data/` on teardown. Re-run this after changing how sections are chunked or which texts are embedded.

The test sets `LAT_LLM_KEY` to `REPLAY_LAT_LLM_KEY::<server-url>`, which `detectProvider` routes to the local replay server. This way the entire codebase runs unmodified — same `fetch()` calls, same provider logic.

### Indexes all sections

Index the RAG fixture (9 sections across 2 files), verify counts.

### Finds auth section for login query

Search for "how do we handle user login and security?" and verify the Authentication section ranks first.

### Finds performance section for latency query

Search for "what tools do we use to measure response times?" and verify the Performance Tests section ranks first.

### Incremental index skips unchanged sections

Re-index unchanged content, verify all sections reported as unchanged with zero re-embedding.

### Detects deleted sections when file is removed

Remove `testing.md`, re-index, verify 4 sections removed and 5 architecture sections remain.
