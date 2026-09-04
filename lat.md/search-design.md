# Search Redesign

Section retrieval uses complete passage coverage and hybrid relevance. V1 is implemented in [[cli#search]]; hierarchy promotion, backlink priors, summary vectors, and reranking remain deferred experiments.

## Coverage and ownership

Index each source passage once under its deepest containing section. Represent ancestor containment through section relationships rather than duplicate descendant embeddings in every ancestor.

[[src/search/index.ts]] indexes owned passages from shared block facts. The public embedder exposes a full-input limit, tokenizer fingerprint, and token counting without truncation. The local model rejects inputs beyond 256 tokens.

Store section identity, parent, source range, heading path, introduction, and direct-body length separately from chunks. A section's direct body excludes child ranges; all source body text must belong to a chunk, including text in non-leaf sections.

Keep passage source offsets, ordinal, block type, content hash, and embedding-input hash. Source identity and embedding-cache identity are separate: equal text can reuse vectors without merging distinct source locations. Ancestor heading edits invalidate affected contextual embeddings; backlink edits do not.

## Chunk boundaries

Pack adjacent Markdown blocks within one owner section using model-aware token budgets. Preserve paragraphs, lists, tables, and code blocks where possible, with explicit fallbacks for oversized blocks.

[[packages/embed/src/index.ts]] exposes input-limit and tokenizer-aware sizing capabilities. Count the full embedding input, including bounded page and heading context and special tokens. Reject accidental truncation during indexing.

V1 targets 192 body tokens with 48 context tokens for the local model, and 512 body tokens with 96 context tokens for hosted models. The assembled input must fit the model limit, including special tokens; context shrinks when necessary.

Apply the following fallback order only when a block exceeds the available body budget:

- Paragraphs: pack complete sentences, then split an oversized sentence at whitespace, then at Unicode-safe text boundaries whose token count fits. Long URLs or unbroken strings must still make progress without dropping text.
- Lists: pack complete items, recursively split an oversized item's child blocks, then use the paragraph fallback for oversized item text. Retain bounded parent-item context for nested items.
- Fenced code: pack complete lines, preferring blank-line boundaries where practical; split a single oversized line using the token-safe text fallback. Retain the language label and continuation metadata. A fragment need not compile independently.
- Tables: pack complete rows with bounded column-header context. Split an oversized row into labeled cell groups, and split an oversized cell using the paragraph fallback. Preserve row and column identity; fragments need not remain Markdown tables.
- Other oversized blocks: use their known internal structure where available, otherwise use the token-safe text fallback.

The final fallback takes the largest practical nonempty source span that fits after counting all added context and special tokens. Reduce optional repeated context if it leaves no room for source text. If even one Unicode-safe source unit cannot fit, fail explicitly rather than silently truncate or loop.

Preserve exact source ranges independently of added embedding context. V1 uses no overlap. Overlap at artificial splits is a future experiment. Every source body span must appear in at least one chunk, and every complete embedding input must fit the model limit.

An introduction is ordinary body evidence unless its quality is established. An optional heading-plus-introduction vector may improve overview retrieval, but duplicate introduction evidence must not receive an independent full-strength fusion vote.

## Candidate retrieval and fusion

Retrieve lexical and vector passage candidates separately, collapse each list to unique owner sections, then fuse section ranks in application code. Retain matched passages as evidence.

The initial lexical index covers passage body plus separately weighted heading/path fields if supported by the chosen engine. Preserve identifiers and paths through tested tokenization or an exact-match route. Treat ordinary queries as literal text rather than implicitly exposing the FTS query language.

The baseline passage aggregation is the maximum score per section within each retriever. This avoids mean dilution and unbounded sums, but is not length-neutral: sections with more passages have more opportunities for accidental high scores.

Retrieve adaptively toward roughly 50 unique owner sections per channel, subject to a passage-count and latency cap. Fifty passages may represent very few sections. Record cap exhaustion and measure unique-section candidate recall.

Reassign consecutive section ranks after collapse. Equal-scoring sections share rank; section IDs provide stable presentation order without fabricating score differences. A missing section contributes zero to that channel.

Use weighted reciprocal rank fusion as the initial baseline:

```text
R(s) = wL / (k + rankL(s)) + wV / (k + rankV(s))
```

Absent terms are omitted. Start with equal weights and trial k = 60, alongside smaller constants. Candidate depth, k, and channel weights must be evaluated together. RRF measures rank agreement, discards score margins, and supplies no absolute relevance threshold.

Keep summary or section-level retrieval within a fixed channel-weight budget if added later. Multiple correlated lexical indexes must not silently give lexical retrieval extra votes. Exact section-ID lookup can use the existing resolver before relevance ranking.

## Hierarchy and answer scope

Deferred beyond V1: choose the most specific sufficient answer scope, distinguishing a parent containing relevant material from a section that directly answers the query.

After owner-section fusion, admit ancestors as candidates with provenance pointing to their matching descendants. A trial inherited relevance is the maximum descendant score multiplied by gamma to the tree-edge distance, with 0 < gamma < 1. Combine with direct relevance by maximum, not sum.

This conservative baseline permits parents without automatically rewarding large subtrees. A parent whose own text matches remains independently eligible. Pure descendant maximum is insufficient for broad questions requiring several children; evaluate reranking using the parent introduction and a bounded, diverse set of child passages.

Keep multiple children when they provide distinct evidence. Suppress a redundant parent or child in final selection only when it adds no useful evidence. For cross-child questions, evaluate promotion to their lowest useful common ancestor rather than always promoting to the page root.

Context expansion is a separate token-budgeted step. It can include nearby passages, introductions, or relevant siblings, with source citations and overlap deduplication. A returned parent does not require loading its entire subtree.

## Lexical scope experiments

Start with passage FTS, and evaluate a separate section lexical representation if queries requiring terms across passage boundaries show poor recall.

Whole direct-body FTS can combine terms split across passages without repeating descendant text. Whole-subtree FTS additionally covers terms split across children, but duplicates text across levels, alters document-frequency statistics, and risks ranking oversized ancestors.

Do not mix whole sections and passages as indistinguishable documents in one BM25 population. Compare passage-only retrieval with separate direct-body or subtree retrieval and bounded fusion weights. Test title-field boosts against repeated breadcrumbs dominating passage body matches.

## Backlink prior

Deferred beyond V1: evaluate backlinks as a bounded prior after relevance retrieval. The shipped ranking has no authority boost.

Count distinct resolved source sections rather than raw link occurrences, excluding self-links. Keep Markdown references and mandatory code-to-spec references distinguishable; code coverage is not automatically editorial authority. Compare distinct source files if repeated boilerplate dominates.

A trial bounded authority model is:

```text
D(s) = log1p(distinctDirectBacklinkSources(s))
I(s) = sum over ancestors a of 0.4^distance(a,s) * D(a)
A(s) = (D(s) + eta * I(s)) / (1 + D(s) + eta * I(s))
score(s) = relevance(s) * (1 + epsilon * A(s))
```

Use eta = 0 initially; trial inherited authority separately. Trial epsilon = 0.05 against zero, giving a maximum 5% boost. These are evaluation parameters, not established constants. Many inherited links can still outweigh one direct link; a strict direct-link preference would require an explicit policy.

Do not propagate authority through siblings or recursively mix containment edges with editorial links. Popular containing pages do not necessarily make every descendant authoritative.

## Storage and migration

V1 uses local Turso 0.7.2 after testing scoring, rollback, and checkpointed index copies. libSQL remains only as a lazy reader for legacy migration and backend inspection during init.

Tables store sections with parent pointers, owned chunks, reusable embeddings, exact identifier tokens, and metadata. Authority and closure tables are deferred. Initial and large-batch indexing build FTS after inserting rows to avoid costly per-row maintenance.

[[src/search/db.ts]] uses exact cosine scans as described in Turso's [vector guide](https://docs.turso.tech/guides/vector-search). Published cross-process readers use experimental multiprocess_wal. Unpublished staging uses single-process mode to avoid a large-FTS-build stall observed with multiprocess WAL. FTS requires experimental index_method and an exact-column, score-only query with LIMIT; higher observed scores are better.

The [TypeScript reference](https://docs.turso.tech/sdk/ts/reference) supports local use through `@tursodatabase/database`. The [FTS reference](https://docs.turso.tech/sql-reference/functions/fts) documents Tantivy indexes and BM25, but its score-direction prose and examples conflict. Verify ordering with an independently understood fixture.

The reported [fts_score query-shape bug](https://github.com/tursodatabase/turso/issues/7637) affects local npm bindings in the reported version. Probe score-only, exact-index-column, filtered, and joined queries on the selected release; do not assume documentation examples are reliable workarounds.

The storage spike must exercise insert/update/delete, rollback, reopen persistence, reader/writer visibility, FTS scoring, tokenization, exact vector results, packaging, and portable deployment. Measure realistic chunk counts and both embedding dimensions. Keep fusion outside complex SQL.

[[src/search/cache.ts]] stages checkpointed generations and publishes their manifest atomically under a process-owned writer lock. Schema, chunk policy, tokenizer, contextualization, and model identity are versioned. Failed work preserves the active index.

Legacy vectors.db is archived as vectors.db.old-12, with numbered suffixes on collision, and automatically rebuilt by indexing-capable search. Migration metadata preserves the old model across interrupted attempts. Hooks never migrate. Published generations remain available for existing readers; cache cleanup is manual in V1.

## Result contract

Return ranked sections with matched passages and separate score components. Hybrid scores must not be exposed as cosine similarities or treated as calibrated confidence.

[[src/search/search.ts]] applies a configurable 0.20 semantic floor while retaining independent lexical evidence. The public fields distinguish rankScore, semanticSimilarity, lexical evidence, and source ranges. Graph sizing uses relative rankScore.

CLI exposes --min-similarity and --preview passage|intro|both; MCP exposes minSimilarity. Passage previews are the default in CLI, MCP, and UI. Preview variants do not affect ranking. Debug output includes channel contributions and candidate-budget exhaustion.

## Evaluation and delivery

Build a judged query set before tuning the ranking model. Label both relevant content and acceptable answer sections, including cases where the preferred granularity is a parent.

Include exact names and identifiers, paraphrases, deep tail matches, missing or misleading introductions, oversized code blocks, terms split across passages or children, duplicate headings, irrelevant hubs, and genuinely unrelated queries.

Measure unique-section candidate recall, nDCG at 5 and 10, exact-target reciprocal rank, evidence coverage, parent/child redundancy, latency, indexing time, and cache size. Stratify by section length and depth, and evaluate local and hosted embeddings separately with held-out queries.

Use invariance probes: append unrelated text, repeat identical blocks, increase overlap, duplicate backlink occurrences, and move a section beneath a popular ancestor. Measure unjustified rank changes; maximum passage scoring alone does not guarantee invariance.

[[tests/cases/hybrid/judgments.json]] fixes 40 development and 20 held-out queries, including two deferred parent-scope queries. Run pnpm eval:search for local quality evaluation and pnpm bench:search for exact-retrieval scale measurements.

Related research includes [Reciprocal Rank Fusion](https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/) and [Document-Aware Passage Retrieval](https://aclanthology.org/2024.acl-long.236/). They motivate experiments, not a claim that Lat's hierarchy or embedding model has already been validated.

### Repository relevance case

The query `how to format links to external source files` should retrieve [[external-sources#External Sources#Link Syntax]] within the default five results. Use it to evaluate lexical word-form handling alongside semantic retrieval.

On the current repository with local MiniLM, the section ranks second semantically, 60th lexically, and 13th after fusion. Its three owned passages include the syntax and examples; neither missing coverage nor the cosine floor explains the miss.

The current FTS configuration distinguishes `links` from `link`, `files` from `file`, and `source` from `sources`. This loses the heading boost for `Link Syntax` and body matches for `file`. A diagnostic lexical query including both forms moves the target to lexical rank four and fused rank one while keeping semantic results fixed. Lowering the fusion constant alone to 20, 10, or 5 leaves it outside the top five.

Continue evaluating word-form normalization on a broader repository query set. Preserve exact identifiers and test singular/plural paraphrases plus unrelated queries; do not special-case this query or blindly strip trailing letters. These observations describe the unstemmed baseline. The application-side stemming implementation below addresses word forms without changing fusion weights.

The pinned `@tursodatabase/database` 0.7.2 accepts only `default`, `raw`, `simple`, `whitespace`, and `ngram` tokenizers. In-memory probes reject Tantivy's `en_stem` tokenizer; Turso does not expose its English stemmer. Arbitrary `stemming` and `synonyms` index options are accepted but do not enable matching in probes. Prefer an upstream tokenizer capability when available; current integration needs application-side normalization or an engine change. See [Turso FTS options](https://docs.turso.tech/sql-reference/functions/fts) and [Tantivy tokenizers](https://docs.rs/tantivy/latest/tantivy/tokenizer/index.html).

### Image authoring coverage

[[markdown#Images]] provides an explicit answer section for image-authoring queries. Evaluate missing answer coverage separately from ranking failures when testing the repository corpus.

Before that section existed, `how to add images in wiki` returned parser and wiki-link internals; the scattered image-path guidance under Relative Links ranked fifteenth. With the image syntax and asset rules documented together, Images ranks first lexically and semantically for that query without ranking changes.

The same section ranks first for `how to add images`, `images`, and `how to embed an image in a page`. The broader paraphrase `how to add a picture to a note` ranks it fifth in the measured local-model snapshot; keep that wording as a harder relevance case rather than assuming synonyms are fully solved.

### Application-side stemming

[[packages/stemmer]] supplies English Snowball stemming through a small Rust/WASM package. [[src/search/lexical.ts]] applies identical analysis to document fields and query terms for lexical matching.

The public package exports `stem`, `stemWords`, and `STEMMER_VERSION`. It wraps Tantivy's standalone `rust-stemmers` dependency, loads the bundled WASM lazily, and has no runtime npm dependencies or model downloads. Rust is required only for source builds.

Version 0.1.0 measures 31,138 bytes for WASM and 18,753 bytes for the compressed npm package, including JavaScript, types, README, and license notices. The unpacked package runs independently of the repository; server dependency tracing includes its glue and WASM.

Split Unicode word tokens and lowercase them; stem ASCII English words while retaining other tokens. This English policy is not language detection or synonym expansion. Exact identifiers continue through their separate lookup route.

Store normalized body, heading, and ancestor path in `lexical_chunks`, keyed to the original passage ID. FTS uses whitespace tokenization to preserve emitted tokens and retains body/heading/path weights of 1/2/0.5. Preserve occurrence order and frequency; original passages supply embeddings, previews, and source spans.

The lexical policy version is independent of embedding fingerprints. A normal writable search upgrades old lexical indexes in a staged generation while reusing vectors; read-only sessions require an up-to-date index. Section edits remove old normalized rows before inserting replacements. Hosted embedding calls are skipped when there are no new inputs.

With stemming enabled, the repository's external-link question returns Link Syntax third (lexical rank nine and semantic rank two in the measured snapshot), inside the default five results. Normalizing the whole corpus changes BM25 statistics, so this differs from the earlier query-only expansion experiment.

## Validation snapshot

Local quality and synthetic retrieval measurements are saved as reproducible artifacts. They establish a V1 baseline, not a claim of production-corpus or hosted-model relevance quality.

[[tests/cases/hybrid/evaluation-local.json]] records local MiniLM results. The 18 held-out queries in V1 scope have full relevant-section recall and nDCG at 5 of 1.0; unrelated queries in this small fixture return no matches. Parent-scope queries remain deferred.

[[tests/cases/hybrid/evaluation-stemmed.json]] records the stemming variant against the same judgments. Held-out metrics remain unchanged. Development nDCG at 5 decreases from 0.9481 to 0.9378: the inactivity question moves Session expiration from first to second, and the unrelated whale-migration query now matches Deploy rollback. Review lexical-only admission on a broader judged corpus; stemming does not guarantee relevance.

[[tests/cases/hybrid/benchmark-local.json]] records the pre-stemming baseline with 10,000 sections at 10k, 50k, and 100k synthetic chunks for 384 and 1536 dimensions. Warm retrieval p95 at 50k chunks was approximately 140 ms and 251 ms on Apple M4 Pro.

The synthetic benchmark uses precomputed vectors and isolates storage/retrieval cost; its indexing timing excludes embedding generation and Markdown chunking. Hosted transport/tokenizer behavior is tested with mocked responses. A live hosted relevance run was blocked by provider HTTP 401; rerun pnpm eval:search --remote with a valid credential to measure it.
