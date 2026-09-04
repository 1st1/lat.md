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
(`tests/rag-replay-server.ts`); it runs only when `tests/cases/rag/replay-data/owned-blocks-v1/` is present and is
re-cooked with `pnpm cook-test-rag` if hosted chunking changes.

### Indexes all sections

Index the RAG fixture (9 sections across 2 files), verify counts.

### Finds auth section for login query

Search for "how do we handle user login and security?" and verify the Authentication section ranks
first.

### Filters results below the similarity threshold

Semantic candidates must meet the requested cosine minimum. Independent lexical matches remain eligible below this threshold.

### Applies the shared default similarity threshold

Every semantic-search path applies [[src/search/search.ts#DEFAULT_MIN_SIMILARITY]] unless its public interface supplies an
explicit override, keeping CLI, MCP, hooks, and UI ranking policy aligned.

### Applies the shared default result limit

CLI, MCP, and prompt-hook semantic search use [[src/search/search.ts#DEFAULT_SEARCH_LIMIT]] unless a caller explicitly overrides it; the UI retains its named presentation-specific limit.

### Finds performance section for latency query

Search for "what tools do we use to measure response times?" and verify the Performance Tests
section ranks first.

### Debug output includes similarity scores

Search debug output exposes the fused rank score and individual retrieval contributions while normal output shows source evidence.

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
search: the old file is archived with .old-12, a Turso index is built at 384 dimensions, and the query succeeds.

This is the pre-versioning `.cache` upgrade path — before, the stale table was queried and threw a
raw dimension-mismatch error.

### Reuses an indexed search session

An indexed search session owns one database and embedder, applies each query's limit and threshold, and returns storage rows without project metadata. A shared resolver hydrates known section ids for every caller.

### Skips an unbuilt search index

Opening a query-only session before an index exists returns no matches without loading an embedder, while still closing the database cleanly.

### Patches generated WASM loading explicitly

The package build replaces wasm-bindgen's opaque filesystem loader with an explicit byte initializer that is idempotent and discoverable by deployment tracers.

### Rejects unknown generated WASM glue

The package build fails clearly when generated wasm-bindgen output no longer contains the loader shape Lat knows how to replace.

## Hybrid Retrieval

Tests in [[tests/hybrid-search.test.ts]] verify passage ownership, token safety, hybrid evidence, and transactional cache publication.

### Preserves complete passage coverage

Oversized prose, nested lists, code lines, table cells, and Unicode retain source coverage and fit the embedding model input budget without duplicating descendant content.

### Rejects local embedding truncation

The real local tokenizer counts the full input and the WASM embedder rejects text beyond its limit, including tokenizer configurations containing an embedded truncation setting.

### Retrieves lexical evidence independently

Exact identifiers remain discoverable below the semantic minimum, with evidence linked to source spans in the owning section.

### Collapses before rank fusion

Repeated passage owners collapse before ranks are assigned, and equal channel scores share a section rank.

### Reuses vectors after source movement

Adding blank lines changes source locations without re-embedding unchanged contextual inputs.

### Reuses unchanged chunks within edited sections

A word replacement within one passage embeds only that passage, preserves the other passage hashes in the same section, and updates searchable evidence.

### Publishes only successful generations

A failed replacement leaves the existing manifest and complete searchable generation intact.

### Preserves FTS rollback and portable copies

Rolled-back writes do not leak into FTS; a checkpointed database retains scored search when copied and reopened.

### Switches preview without changing relevance

Passage, introduction, and combined previews use the same ranked match while changing only its presentation.

### Archives legacy caches without overwriting backups

Migration reads the old model and archives the libSQL file with a collision-safe .old-12 suffix before publishing the new index.

Legacy inspection and fixture creation finish in separate processes before archival, releasing native file handles on Windows.

### Serializes concurrent index writers

Concurrent writers cannot interleave publication, and an existing reader remains usable after another generation is published.

### Rejects invalid vectors before changing the index

Missing or malformed embedding output fails before indexed data is modified, preserving previous retrieval evidence.

### Validates hosted input and response ordering

The hosted tokenizer rejects oversized input before network access, and response vectors are reordered to match input indices.

### Overfetches toward unique sections

Repeated passages from one owner trigger deeper candidate retrieval, while the hard passage budget reports exhaustion instead of pretending section recall is complete.

### Keeps readers alive across process boundaries

A child process can open a published FTS generation while the parent publishes its replacement, and the child retains its original evidence until it closes.

Windows published-generation readers use private copies so FTS can write without locking the published file. Publication never acquires a write lock on the active generation.

### Stems English lexical fields and queries

English inflections match across indexed fields and queries while original evidence, Unicode tokens, and exact identifier lookup remain intact. Updating a passage removes its old lexical terms.

### Upgrades lexical indexes without embedding again

An index with unstemmed FTS migrates to normalized lexical fields without regenerating vectors or changing source passages.

### Packages stemmer runtime assets

Server dependency tracing includes both the stemmer JavaScript glue and WASM binary so deployed search can initialize outside the workspace.
