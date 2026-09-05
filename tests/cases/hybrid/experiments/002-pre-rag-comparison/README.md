# Pre-RAG versus current retrieval

The current RAG substantially improves this frozen 100-query audit. It returns a direct answer in the default five for **91 queries versus 81** at the immediate pre-RAG checkpoint, with **11 gains and one regression**. This compares retrieval implementations on identical content; it does not measure documentation improvements or hosted embeddings.

## Code and corpus controls

| Arm | Commit | Behavior |
| --- | --- | --- |
| Primary pre-RAG checkpoint | `b1391996e836a07e4bdaa636a366c5cd99d1449c` | Immediate parent of RAG commit `02c3dbe`; package version 0.12.2; one embedding per section, historical truncation, vector-only retrieval, cosine floor 0.35 |
| Current branch | `74658ec6302b10a535df208e326ca2514b89a4ef` | Owned passages, contextual embeddings, stemmed FTS plus vector search, equal-weight RRF k=60, cosine floor 0.2, repaired FTS statistics |
| Secondary exact v0.12.2 release | `8d345ed24e4ebff8c348e3bf9ef9e06a17677af6` | Original released vector search, no similarity floor; native return order retained |

Three isolated local clones were rolled back to their commits. Each received exactly the same 39 Markdown files from the original agent audit (commit 72fbf5c plus saved patch), verified against every SHA-256 hash. Each index was built fresh. The current arm does not reuse the old audit's history-dependent FTS index.

All arms indexed 506 sections with identical section IDs. Old/new use identical MiniLM 384 weights and tokenizer; all 100 primary old/current query vectors are bit-identical. The historical embedding package was rebuilt from its historical TypeScript/Rust code to preserve truncation. Using the current embedding package in the old checkout would be invalid because its oversized-input behavior changed.

Dependencies were reconstructed offline using compatible installed packages, not clean registry installations. Exact versions, hashes, source checks, and reproduction commands are in [setup-notes.md](setup-notes.md) and [dependency-evidence.json](dependency-evidence.json). Frozen new documentation references symbols absent from old code, so historical graph validation reports expected mismatches; these were retained in [historical-validation.txt](historical-validation.txt), not patched away.

## Relevance results

Each arm was queried separately at limits 5 and 10; all 100 top-five lists happened to equal the top-ten prefixes. Existing grades were reused by exact query/section identity. Reviewers read the frozen content for 311 new pairs, yielding **1,578 total judgments**. All returned positions are judged. Parent sections include their descendants when judging relevance.

Grade 2 is a direct answer, grade 1 useful partial context, and grade 0 irrelevant. A direct answer may address one substantial facet rather than complete every requested facet.

| Metric | Pre-RAG checkpoint | Current | Exact release |
| --- | ---: | ---: | ---: |
| Direct answer first, all 100 | 60 | **75** | 61 |
| Direct answer within 5, all 100 | 81 | **91** | 82 |
| Direct answer within 10, all 100 | 87 | **92** | 89 |
| Direct answer within 5, 93 indexed-answer queries | 87.1% | **97.8%** | 88.2% |
| MRR@10, indexed-answer queries | 0.7504 | **0.8754** | 0.7624 |
| Pooled nDCG@5, indexed-answer queries | 0.6354 | **0.8092** | 0.6441 |
| Mean irrelevant results in5, indexed-answer queries | 1.441 | **0.860** | 1.570 |

Versus the primary checkpoint, indexed-answer nDCG@5 improves 0.1738 (+27.3% relative), while irrelevant top-five results fall 40.3%. The nDCG ideal uses the same combined judged pool for every arm; it is not exhaustive corpus recall and should not be compared directly with older experiments that used a smaller judgment pool.

New direct-answer top-five gains: q001 external-source link syntax; q014 graph-link participation; q017 packed Markdown reference-definition validation; q037 project-root/symlink discovery; q064 source-link icon wrapping; q078 build destination overwrite rules; q079 preindexed server search/cold starts; q085 missing-init-version warnings; q087 generated AGENTS template validation; q091 CI/preview workflow; q099 installation/setup navigation.

The regression is **q063**, segmented wiki-link underline/color styling: Markdown navigation falls from rank 2 to rank 7. Current fusion favors sections about reference counts, parsing, and graph rendering above the styling answer. This confirms the remaining intent/scope ranking weakness rather than showing uniformly better results.

The banana/weather negative control returns no results in primary old/current, while the exact release returns unrelated results. Non-indexed/ambiguous queries remain visible in all-query metrics rather than being silently discarded.

## Runtime and indexing

The uncontended performance run alternates arms across 300 cached-vector searches per arm and 20 warm total queries per arm, at the native default limit 5. All 640 searches matched the saved IDs and scores. These are persistent-session search times, not process startup or complete CLI latency.

| Measurement | Pre-RAG checkpoint | Current |
| --- | ---: | ---: |
| Engine median | 3.36 ms | **2.20 ms** |
| Engine p95 | 3.72 ms | **2.45 ms** |
| Warm total median | 17.64 ms | **16.55 ms** |
| Warm total p95 | 23.22 ms | **21.85 ms** |
| Fresh indexing, warmed model/parser caches | 7.50 s | **7.00 s** |
| Time inside embedding calls | 4.63 s | 5.81 s |
| Embedding inputs | 506 | 716 |

The new implementation embeds 41.5% more inputs and spent 25.3% more time embedding, yet overall indexing was 6.7% faster in this single sequential measurement. The indexing sample excludes schema setup and starts with warmed models and existing parser caches. It is diagnostic, not a general scaling claim. Initial quality-run indexing timings were concurrent and must not be used for performance comparison. Raw samples are in [latency.json](latency.json).

## Replay and rollback

Fast metric replay needs no embedding, indexing, or network:

```sh
node scripts/evaluate-rag-comparison.mjs
```

It validates all query identities, rejects conflicting/missing grades, and writes a new immutable timestamped evaluation. [comparison.json](comparison.json) identifies the reviewed run; compressed per-arm result files preserve native outputs and query vectors. The exact compressed databases are retained locally under `/tmp/lat-012-comparison/archives`; [indexes.json](indexes.json) records their hashes and locations. These roughly 40 MB of database binaries are not committed. The versioned corpus, source commits, native result snapshots, vectors, labels, and runners support fresh reconstruction; approximate-index rebuilding may require checking output parity.

For a fresh search replay, prepare separate checkouts:

```sh
node scripts/prepare-rag-comparison.mjs b139199 /tmp/rag-repeat/old
node scripts/prepare-rag-comparison.mjs 74658ec /tmp/rag-repeat/new
node scripts/prepare-rag-comparison.mjs 8d345ed /tmp/rag-repeat/release
```

Follow the historical dependency setup notes. For current code, use its matching installed dependencies/build. Then run each runner from the main repository with arguments `CHECKOUT OUTPUT_JSON AUDIT_DIRECTORY`:

```sh
node --import tsx scripts/run-pre-rag-comparison.mjs /tmp/rag-repeat/old /tmp/rag-repeat/old-results.json tests/cases/hybrid/real-query-audit
node --import tsx scripts/run-current-rag-comparison.mjs /tmp/rag-repeat/new /tmp/rag-repeat/new-results.json tests/cases/hybrid/real-query-audit
node --import tsx scripts/run-release-rag-comparison.mjs /tmp/rag-repeat/release /tmp/rag-repeat/release-results.json tests/cases/hybrid/real-query-audit
node --import tsx scripts/benchmark-rag-generations.mjs /tmp/rag-repeat
```

The quality runners refuse existing indexes and output files. Repeated comparisons belong in separate artifact directories; preserve this experiment's content and grades. Additional surfaced pairs require review before metrics are published.

Use `git worktree add ../lat-known-rag 74658ec` to inspect the tested current code without resetting the working tree. No ranking formula was changed during this comparison.

## Limits

These are previously inspected queries from one repository, not an untouched holdout. The corpus includes new-RAG design and audit prose, including known example questions. Giving identical content to both arms controls document differences but does not remove that sample bias. The comparison measures the complete old/new retrieval implementations, including thresholds, chunking, stemming, and database changes; it does not isolate which component caused each improvement. Fresh unseen queries and additional repositories remain necessary to assess generalization.
