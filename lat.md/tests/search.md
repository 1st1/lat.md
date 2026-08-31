---
lat:
  require-code-mention: true
---
# Search

Tests in `tests/search.test.ts`.

## Provider Detection

Unit tests (always run). Verify `detectProvider` (now exported from
[[packages/embed/src/remote.ts#detectProvider]] in `@lat.md/embed`) correctly identifies OpenAI
(`sk-`), Vercel (`vck_`), rejects Anthropic (`sk-ant-`) with a helpful message, and rejects unknown
prefixes.

## RAG Tests

Functional tests that exercise the full RAG pipeline using the **local MiniLM engine**, which
produces deterministic vectors — so they run the real WASM embedder directly, with no API key, no
network, and no replay recording.

The test covers indexing, hashing, vector insert, and KNN search. Fixture lives in
`tests/cases/rag/lat.md/` (9 sections across 2 files). A supplementary `search (rag, hosted replay)`
group exercises the hosted `fetch` backend against a local OpenAI-compatible replay server
(`tests/rag-replay-server.ts`); it runs only when `tests/cases/rag/replay-data/` is present and is
re-cooked with `pnpm cook-test-rag` if hosted chunking changes.

### Indexes all sections

Index the RAG fixture (9 sections across 2 files), verify counts.

### Finds auth section for login query

Search for "how do we handle user login and security?" and verify the Authentication section ranks
first.

### Filters results below the similarity threshold

Semantic search returns only candidates at or above the requested cosine-similarity threshold so
callers can trade recall for less low-relevance noise.

### Discards negative similarity scores

Every semantic-search path applies a zero score floor even without an explicit relevance threshold,
so results pointing away from the query in embedding space are never returned.

### Finds performance section for latency query

Search for "what tools do we use to measure response times?" and verify the Performance Tests
section ranks first.

### Debug output includes similarity scores

Search result formatting includes each cosine-similarity score when debug output is requested and
keeps scores out of the normal output.

### Deterministic embeddings

Embedding the same text twice yields byte-identical vectors — the property that lets the local RAG
tests run the real engine without recording fixtures.

### Incremental index skips unchanged sections

Re-index unchanged content, verify all sections reported as unchanged with zero re-embedding.

### Detects deleted sections when file is removed

Remove `testing.md`, re-index, verify 4 sections removed and 5 architecture sections remain.

### Reads each file once when indexing

A passthrough `readFile` spy verifies indexing reads each `lat.md` file a bounded number of times
however many sections it holds: the parser reads it once and section slicing reuses that read.

Before this was pinned, a 3.5 MB file holding 12k sections was re-read once per section — 12k
times on every search.

### Rebuilds a legacy cache with no recorded model

Seed a 1536-dim `sections` table with rows but no `meta.embedding_model`, then run a local-backed
search: the mismatched table is dropped and rebuilt at 384 dims and the query succeeds.

This is the pre-versioning `.cache` upgrade path — before, the stale table was queried and threw a
raw dimension-mismatch error.
