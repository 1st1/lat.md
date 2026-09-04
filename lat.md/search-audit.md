# Retrieval Tuning Assessment

Controlled local-model experiments separate candidate quality from fusion behavior. The strongest next experiments concern lexical query coverage and passage context; changing RRF alone does not resolve image-test retrieval.

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

[[search-design#Incremental indexing]] describes current cache guarantees and the next optimization: retain chunk layouts for unchanged files. Do not infer one embedding per paragraph, whole-section re-embedding on every edit, or historical hash retention from these measurements.
