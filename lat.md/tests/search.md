---
lat:
  require-code-mention: true
---
# Search

Tests in `tests/search.test.ts`.

## Provider Detection

Unit tests (always run). Verify `detectProvider` correctly identifies OpenAI (`sk-`), Vercel (`vck_`), returns the local provider when no key is given, rejects Anthropic (`sk-ant-`) with a helpful message, and rejects unknown prefixes.

## Schema Dimension Mismatch

Verify that `ensureSchema` rebuilds the sections table when stored dimensions differ from the provider's.

Creates a DB at 1536 dimensions with a row, re-inits at 384, asserts the table is empty and the new dimension is stored in meta.

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
