# Retrieval Tuning Assessment

Controlled local-model experiments separate candidate quality from fusion behavior. The strongest next experiments concern lexical query coverage and passage context; changing RRF alone does not resolve image-test retrieval.

Benchmark tooling is not shipped in this repository. These records retain historical methods, results, and rollback references; archived commands require the tooling from their recorded commits. Current behavior is defined in [[rag-architecture]].

## Method

The repository audit uses a disposable copy of the index at commit `ec930be`, excluding the Images section and search-design document. Production retrieval settings remain unchanged.

Five probes cover image authoring, a picture/note paraphrase, external-link formatting, and an unrelated whale-migration query. A separate sweep uses the existing 40 development and 20 held-out judgments, excluding two deferred parent-scope questions from metrics.

Repository rankings are diagnostic, not a new judged benchmark. Tests mentioning images vary in usefulness: path handling and linked-image rendering are stronger evidence than a generic feature list or error-message test. The synthetic suite is too small and easy to establish safe global defaults.

## Existing image evidence

The query `how to add images in wiki` finds some image tests but suppresses others. The normalized lexical query is `add OR imag OR wiki`, so a match on a generic verb or wiki heading can compete with actual image evidence.

| Existing section | Fused rank | Best chunk cosine |
| --- | ---: | ---: |
| [[tests/check-links#Names the resolved file and the link kind]] | 5 | 0.347 |
| [[tests/roundtrip#Covered features]] | 6 | 0.344 |
| [[markdown#Relative Links]] | 15 | 0.255 |
| [[view/specs#Serves the document index and browser shell]] | 71 | 0.147 |
| [[view/specs#Renders Markdown with navigable local links]] | 87 | 0.163 |

The latter two are present in lexical candidates, but their best semantic scores are below the 0.20 floor. They receive only one fusion contribution. Increasing retrieval depth does not repair their poor semantic ordering.

## Formula and lexical experiments

Field weights and query coverage affect this case more than the fusion constant. None of the probes justifies replacing the current defaults without broader relevance judgments.

| Variant | Effect on the image query |
| --- | --- |
| RRF k = 5, 10, or 20 | Does not bring the browser image tests near the top; sometimes promotes the unrelated Add command |
| Semantic weight 0.5 or 2 | Does not fix the image case |
| Candidate depth 100 or 200 | Top five essentially unchanged |
| Semantic floor 0.10 | Top five unchanged; admits more weak semantic evidence |
| Whole owner-body FTS instead of passage FTS | Does not fix the image case |
| Body/heading/path weights 1/1/0.25 | Broken-image test rises to third; roundtrip test to fifth |
| Weights 1/0.01/0.01 | Broken-image and roundtrip tests rise to first and second; browser tests remain low |
| BM25 multiplied by fraction of query terms present | Roundtrip test rises from sixth to third |
| At least two distinct query terms per lexical passage | Roundtrip test becomes first, but browser image tests disappear entirely |

The strict two-term rule also removes useful tests from `how to add images`, because those passages contain image evidence without the verb add. Exact identifier matches were preserved in the synthetic sweep. Query coverage should be a soft relevance signal or a carefully evaluated admission rule, not unconditional AND matching.

The implementation currently retains all sections in its final overfetch batch rather than trimming to exactly 50 per channel. A strict top-50-section experiment does not fix the image case and drops one browser test entirely. Make the candidate-depth contract explicit before further tuning it.

## Passage and context experiments

Image-related sentences can be diluted by unrelated paragraphs and broad headings in the same embedding. Isolated-paragraph scores identify a promising experiment but do not establish full-corpus ranking gains.

The linked-image paragraph under Renders Markdown with navigable local links scores 0.260 with its existing heading context and 0.348 without that context, versus 0.163 for the section's best current packed chunk. The relative-image-resource paragraph scores 0.169 with context and 0.283 without it, versus 0.147 for the section's best current chunk.

Context is not universally harmful: the broken-image diagnostic paragraph scores 0.347 with its heading context and 0.311 without it. Evaluate smaller natural blocks and less repetitive context rather than removing headings everywhere or granting extra full-strength fusion votes to correlated representations.

## Synthetic cross-check

The fixed fixture can reject obvious regressions, but its held-out results do not distinguish these settings. Repository-specific queries must accompany it.

| Variant | Development nDCG at 5 | Unrelated false positives |
| --- | ---: | ---: |
| Current settings | 0.9378 | 1 |
| k = 10 | 0.9378 | 1 |
| Semantic weight = 2 | 0.9462 | 1 |
| Lower heading weights | 0.9378 | 1 |
| Soft query coverage | 0.9378 | 1 |
| Two-term lexical minimum | 0.9517 | 0 |

All variants retain nDCG at 5 of 1.0 on the 18 in-scope held-out queries. The strict minimum looks best on this fixture while visibly hurting useful repository evidence, demonstrating why that score alone must not select the production policy.

## Recommended order

Keep current production formulas while building a repository evaluation set that distinguishes direct answers, supporting tests, and irrelevant matches. Prioritize query interpretation and passage quality before tuning fusion constants.

First evaluate a modest reduction in heading/path weights and soft coverage of meaningful query terms. Include generic verbs, exact identifiers, heading lookups, picture/image paraphrases, and unrelated queries so generic words do not become mandatory.

Next compare smaller natural passages and bounded heading context with the current packing policy. Measure added embedding count and cost, candidate recall, and section-level quality; do not assume the isolated-paragraph gains transfer unchanged to the whole corpus.

Finally evaluate a small candidate reranker if top results remain dominated by topic mentions rather than useful answers. [Sentence Transformers' retrieval and reranking guidance](https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) describes scoring query-passage pairs after broad retrieval. A reranker still needs relevant candidates and a measured local latency/download budget.

## Indexing performance

Local measurements compare installed 0.12.2 with the hybrid implementation on identical copies of this repository's 502-section documentation corpus. Full rebuilds improve slightly; small edits regress despite chunk embedding reuse.

Measured on Apple M4 Pro with local MiniLM, using the documentation snapshot at `7ac12f8`. The new implementation stores 706 passages versus 502 section vectors in 0.12.2: 40.6% more embeddings. Submitted text grows from 269,484 to 307,815 characters, including new structural context; character counts are not model token counts.

| Operation | 0.12.2 | Hybrid |
| --- | ---: | ---: |
| Full rebuild, median of three | 8.12 s | 6.92 s |
| Embedding portion of full rebuild, median | 4.67 s | 5.75 s |
| Unchanged normal indexing, median of three | 88 ms | 9 ms |
| One-word edit, normal indexing, median of three | 363 ms | 718 ms |
| Offset-only update, single lower-level probe | 87 ms | 909 ms |

Full rebuild measurements include schema creation, indexing, and database closing; hybrid measurements include staging, checkpointing, and publishing. Both use their actual local embedding package and the same copied Markdown. Run versions sequentially to avoid CPU contention. Normal indexing uses `runIndex` without a query. Timings exclude CLI startup, query embedding, and result retrieval; they are local observations, not hosted latency predictions.

The same-length word replacement occurs in External Sources / Link Syntax. It embeds one old section versus one of three new passages. A separate offset probe prepends two blank lines to the file: both versions embed zero inputs, but hybrid rewrites 39 sections' source metadata. A regression test additionally verifies unchanged chunk hashes and refreshed search evidence within one edited section.

A diagnostic hybrid edit took 858 ms: project analysis 110 ms, token counting 589 ms across 13,586 calls, embedding 114 ms, and SQL inside the staging callback 25 ms. Token counting includes lazy initialization of the local model; these are one-run component measurements, not independent medians. Re-chunking unchanged files dominates the avoidable work.

Full embedding time increases about 23%, while total rebuild time decreases about 15% because non-embedding work drops from approximately 3.45 s to 1.17 s. The old path performs individual section writes and maintains a vector index; the new path batches writes in a transaction. This comparison does not isolate every database change.

[[rag-architecture#Incremental indexing]] defines current cache guarantees and the remaining work of regenerating chunk layouts when source changes. Do not infer one embedding per paragraph, whole-section re-embedding on every edit, or historical hash retention from these measurements.

## Real query corpus

Local Codex tool-call history supplies realistic agent search queries for future relevance evaluation. Keep private invocation exports separate from committed fixtures, and add expected-result labels before scoring retrieval quality.

A 2026-09-04 local extraction scanned 79 session logs and selected 24 sessions whose working directories contain a `lat` path component. Fifteen sessions contain 664 search invocations with 652 distinct query strings, spanning July 29 through September 4. One help-only call is excluded.

Extract shell invocations from recorded tool calls, including repository CLI equivalents and commands assembled in arrays or loops. Exclude prose, patches, quoted examples, and heredoc contents. Retain timestamp, working directory, session and call identifiers, and source-log line for provenance. Recorded invocations do not establish successful execution or relevant results.

Four searches ran outside the main Lat checkout; filter working directories when choosing this repository's evaluation inputs. Queries are mostly agent-written keyword searches, with diagnostics and repetitions, rather than a pure sample of short user questions. Match them to the appropriate document snapshot and manually judge relevant sections before forming development and held-out sets.

### 100-query agent audit

Ten local agents evaluated 100 historical queries against a frozen 506-section index, then investigated answers with repository grep and source/test reads. Results distinguish ranking misses from missing or stale documentation.

[[tests/cases/hybrid/real-query-audit]] records exact queries, top-ten results, 990 graded sections, 201 grep evidence entries, 156 source/test evidence entries, root verification, and corpus fingerprints. The sample deliberately balances ten topics; it is not a random or human-labeled benchmark.

Default-five verdicts are 77 good, 16 partial, one poor, and six without a clear indexed answer. A direct answer to at least one substantial facet appears first for 75 queries, within five for 91, and within ten for 92. This weaker criterion does not establish complete answers to compound questions.

Fusion can bury relevant semantic candidates: for the serverless/ephemeral-cache query, Server export ranks ninth semantically but 42nd after fusion with no lexical candidate contribution. Graph-edge semantics ranks sixth semantically but 22nd overall for the ordinary-versus-wiki-link question. Segmented-link styling and external path rules also fall below the default five.

Prioritize experiments on missing-channel fusion behavior and intent qualifiers, then judge multiple requested facets. A larger displayed limit alone adds a first direct answer for only one query in this sample. Candidate rescoring and reranking remain hypotheses; no production formulas changed during evaluation.

Coverage issues include installation guidance in the headingless vault index preamble and exact behavior documented only in source/tests. Decide how headingless content becomes a returnable section. Current graph sizing uses hybrid `rankScore`, and Publishing includes `@lat.md/stemmer` with manifest/workflow references. The frozen audit retains the earlier stale wording as evidence; its corpus is not a current product reference.

### Next ranking experiments

Test fusion and intent-sensitive reranking before changing chunk sizes or adding authority boosts. Preserve the audit baseline and separate missing document coverage from ranking quality.

First distinguish truncated channel lists from true nonmatches. Score both channels for their candidate union before fusion, retaining eligibility thresholds: a genuine zero lexical match must not receive an invented RRF contribution. Compare this with current retrieval and a small weighted-RRF grid, rather than assuming a particular constant fixes the observed misses.

If scope and exclusion errors persist, test a local reranker over the channel candidate union before narrowing to a small fused shortlist. Reranking only the fused top 20 cannot rescue the verified Server export answer at rank 42. Include heading context and matched passages, and evaluate distinctions such as external versus local, styling versus parsing, and no Git/watchers.

Use known answer-section coverage, direct-answer presence, irrelevant results, and latency together. Judge newly surfaced candidates rather than treating unjudged sections as irrelevant. Keep additional unseen queries for confirmation; the 100-query sample is a development audit once it informs tuning.

Independently make headingless page text and pre-heading introductions addressable by retrieval, with page-level identity where no authored section exists. This restores missing coverage that fusion cannot supply; source-only knowledge remains a separate scope decision.

### Fast replay of agent judgments

Reuse the saved query intents, section grades, discovered answer targets, and source evidence when comparing ranking variants. Repeat manual investigation only for newly surfaced or materially changed content.

The audit retains all 100 queries, 990 graded query-section pairs, 201 grep commands with findings, and 156 source/test evidence entries. Evidence records include paths and line ranges; they are findings summaries, not a complete archive of terminal output. Corpus hashes and the baseline patch identify the evaluated document content.

The historical replay runner captured complete passage scores and query vectors, ran the actual retrieval/fusion code, verified baseline top-ten ordering and scores for all 100 queries, and wrote immutable runs with source, corpus, configuration, and label hashes. New results enter a review queue; unjudged results block selection.

Experiment 001 adds explicit grades for 29 discovered targets and 248 newly surfaced pairs, giving 1,267 graded pairs. All 18 variants have fully judged top tens. Cached sweeps take about one second; replay includes known-target ranks beyond the displayed top ten.

Use the frozen corpus and exact archived database for controlled comparisons. Revalidate labels when section contents change. Rebuilding only the FTS index changed lexical scores despite unchanged rows, so reconstructing Markdown alone does not reproduce this baseline.

### Candidate union and weighted RRF result

Experiment 001 retains the production baseline after a predeclared development winner failed validation. Its artifacts preserve every ranking, judgment, configuration, and rollback checkpoint.

The grid compares retrieved versus union-rescored candidates, RRF constants 10/20/60, and semantic weights 1/1.5/2 against lexical weight 1. Union scoring preserves the original section union, scores all its passages in both channels, and retains true lexical nonmatches and the semantic threshold. The pinned engine requires global lexical scoring followed by filtering, adding a full-scan cost.

The topic-stratified split contains 80 development and 20 validation queries (73 and 20 with indexed answers). Selection uses pooled nDCG@5, then direct-answer@5 and MRR@10; validation nDCG@5 and direct-answer@5 must not regress. These previously inspected queries are not an untouched holdout.

The development winner uses retrieved candidates, k=10, and equal weights: development nDCG rises from 0.80455 to 0.81307, but validation falls from 0.84381 to 0.84082. It fails the gate. Under baseline weights and k=60, union rescoring gives identical top-five quality while adding 1.5–3.1 ms median engine time across two measurements on the 716-passage corpus.

The k=20, semantic-weight=1.5 variant is promising for fresh-query confirmation; selecting it after the development winner failed would use validation for tuning. Production remains retrieved candidates, k=60, equal weights. See [[tests/cases/hybrid/experiments/001-union-rrf/README.md]] for commands, measurements, and limitations, and [[tests/cases/hybrid/experiments/registry.json]] for the baseline checkpoint.

## FTS history-dependent scoring

Incremental FTS updates retain historical scoring statistics, so identical live content can rank differently after a rebuild. A standalone engine probe isolates this behavior from Lat's indexing and embedding code.

The recorded FTS probe reproduced drift on Turso 0.7.2 using three rows and same-value SQL updates. Ten repeated updates reverse two lexical results. Checkpoint/reopen preserves the change; DROP/CREATE restores the original scores with identical table contents. Single-process and multiprocess WAL modes agree.

The pinned [Turso source](https://github.com/tursodatabase/turso/blob/046e9cbf67d22491e8ecc941ec2891b02a9f3cad/core/index_method/fts.rs) disables automatic segment merging. [Tantivy 0.26.1 BM25](https://docs.rs/tantivy/0.26.1/src/tantivy/query/bm25.rs.html) includes deleted versions in segment statistics until compaction. This is inherited scoring behavior, not evidence of corrupted source rows; Lat's section replacements expose it during ordinary editing.

Across the frozen 100-query audit, rebuilding changes top-one results for one query, top-five ordering for two, and top-ten ordering or membership for eleven. The two changed top fives retain identical members and direct-answer coverage. Raw results, reproduction commands, and qualifications are in [[tests/cases/hybrid/fts-history/README.md]].

OPTIMIZE INDEX repairs small update examples but skips the single-segment deletion case and differs from rebuilt rankings in the audit. Rebuilding only the derived FTS index takes about 8 ms on 716 passages without embedding work; larger-corpus costs remain unmeasured.

Indexing now transactionally rebuilds FTS after replacement/deletion batches. The live-statistics lexical version repairs existing indexes once without embedding calls. Tests compare incremental edits and deletions with fresh scores, and verify rebuild/maintenance rollback. No-op searches and embedding reuse remain intact; the historical ranking experiment stays frozen.
