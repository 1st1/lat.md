# 100-query retrieval audit

The current implementation is a useful search starting point, but it is less reliable at delivering every important part of a question in the default five results. The audit found concrete fusion/ranking misses alongside documentation gaps that no ranking formula can repair.

## Results

Ten local agents ran 100 distinct historical queries and investigated the answers with repository `rg` searches plus documentation, implementation and test reads. The 990 returned sections each have a relevance grade and reason. Root checks validated IDs, ordering and evidence paths/ranges and independently inspected representative failures.

| Default-five verdict | Queries |
| --- | ---: |
| Good: clear useful answer | 77 |
| Partial: key facet missing or obscured | 16 |
| Poor: wrong-topic navigation for browser symptom | 1 |
| No clear indexed answer | 6 |

At least one direct answer appears first for 75 queries, within five for 91, and within ten for 92. This is weaker than complete task success: a section may directly answer one substantial facet while omitting another. Of 495 returned top-five entries, 232 are direct answers, 171 useful partial context, and 92 incidental/irrelevant. Mean reciprocal rank within ten is 0.8158 across all queries.

For the 93 queries judged to have indexed answers, direct-answer presence is 91/93 at five and 92/93 at ten. The six no-clear-answer cases comprise the correct banana/weather abstention, graph label disambiguation, historical reference-definition visuals, icon licensing, nonexistent core CLI JSON output, and template-language rationale. The separate poor Firefox query has ambiguous answer availability: relevant menu context exists, but no indexed Firefox root-cause diagnosis was established.

| Topic | Good | Partial | Poor | No clear indexed answer |
| --- | ---: | ---: | ---: | ---: |
| Search | 8 | 1 | 0 | 1 |
| Markdown links | 8 | 2 | 0 | 0 |
| External sources | 6 | 4 | 0 | 0 |
| Analysis/performance | 9 | 1 | 0 | 0 |
| Graph | 9 | 0 | 0 | 1 |
| Navigation | 9 | 0 | 1 | 0 |
| Rendering | 7 | 1 | 0 | 2 |
| Deployment | 8 | 2 | 0 | 0 |
| Hooks/CLI | 7 | 2 | 0 | 1 |
| Development | 6 | 3 | 0 | 1 |

## Concrete misses

| Query | Verified answer and observed rank | Implication |
| --- | --- | --- |
| q076: serverless, ephemeral search, no Git/watchers | Server export: semantic 9, fused 42. Portable server spec: semantic 14, fused 45. Neither receives a lexical candidate contribution. | Fusion favors overlapping channels strongly enough to bury semantically useful answers; showing ten results does not solve this. |
| q063: segmented wiki-link underline/color | Markdown navigation 7; precise wiki-link spec 11. | Reference counts/parsing win over the requested styling behavior. |
| q023: external extensionless-path rules | External Resolution Rules 8, behind local-path rules. | Similar vocabulary hides different validation semantics. |
| q027: external repository subdirectory/prefix | Resolution Rules 9; Canonical Configuration 20. | Checkout material appears early, but prefix mapping is buried. |
| q014: ordinary versus wiki links and graph participation | Graph Edges: semantic 6, fused 22. | A relevant facet loses rank despite a strong semantic match. |
| q051: Firefox reference panel opens then closes | Markdown navigation 31; menu and incremental-refresh specs absent from top 50. | Symptom language finds CLI refs/expand instead of browser context; an exact historical diagnosis is not established. |

The deeper probe used limit 50 while retaining the same candidate target of 50, and asserted unchanged top-ten ordering. A null deeper rank means not returned within 50, not proof that a section never matched FTS or embeddings.

## Coverage and content issues

The exact installation command for q099 exists in the headingless `lat.md/lat.md` preamble and outside-vault README, but neither supplies a returnable indexed section. Some other exact answers exist only in code/tests: graph label breadcrumb selection and the TOC icon's MIT-license attribution. Beta-release/dist-tag specifics and template language-enumeration rationale are insufficiently documented. These require an indexing-scope or documentation decision, not a fusion tweak.

Correctly retrieved documentation can also be stale. Graph prose says cosine score while current code uses `rankScore`; Publishing lists four packages while the workflow publishes five, including `@lat.md/stemmer`. The image query is an especially optimistic case: its direct answer was previously added in response to that exact question, and audit pages quote the query. Incidental audit mentions were not graded as direct answers.

## Priorities for the next experiment

1. Investigate missing-channel behavior in fusion. For q076, relevant semantic candidates exist but receive only one RRF contribution. Compare lexical rescoring of semantic candidates, candidate depth and reranking on judged cases before changing global weights.
2. Preserve intent qualifiers and exclusions. External versus local paths, browser styling versus parsing/counts, and “no Git/watchers” need stronger treatment than broad word overlap. Query interpretation or a reranker may help; these are hypotheses, not tested fixes.
3. Evaluate coverage of multiple requested facets, not only whether any top-five result is relevant. Raising the displayed limit to ten adds a first direct answer for only one query here, though it can recover additional facets on other queries.
4. Decide how headingless pages/preambles map to returnable sections, and add concise indexed explanations for important source-only behavior. Correct stale package/graph documentation separately from ranking work.

No ranking, chunking, source-indexing, or documentation fixes were made during the audit. Preserve this baseline, then evaluate changes with additional held-out queries and manual relevance review.

## Artifacts

- [findings.md](findings.md): compact findings for every query.
- [queries.json](queries.json): exact selected queries and historical frequency/date provenance.
- [results.json](results.json): frozen top-ten results, channel scores/ranks and matched passages.
- [judgments.json](judgments.json): every grade, interpreted intent, independent grep evidence, source evidence and known answer sections.
- [summary.json](summary.json): aggregate metrics and topic breakdowns.
- [deeper-targets.json](deeper-targets.json): 21-query probe of known answer targets beyond rank ten.
- [root-checks.json](root-checks.json): parent verification and evidence-range corrections.
- [corpus.json](corpus.json), [corpus.patch](corpus.patch), [index-meta.json](index-meta.json): exact snapshot identity. Apply the patch with `git apply --unidiff-zero corpus.patch` at the recorded base commit in an isolated checkout to recover the evaluated Markdown snapshot.
- `batches/01.md` through `batches/10.md`: individual agent summaries.

Recorded investigation evidence: 201 query-specific grep entries and 156 source/test evidence entries. Raw timings are not a benchmark.

## Methodology and limitations

This audit evaluates 100 distinct historical `lat search` queries against the current repository using 10 local agents, each responsible for 10 queries. The root agent validates records and checks representative failures. No ranking changes are part of the audit.

### Corpus and selection

The source is a local extraction of 664 recorded search invocations (652 distinct queries). This is a purposive, topic-balanced sample, not a random sample of users or traffic. All selected strings occur verbatim in the history and have at least one invocation with working directory `/Users/yury/dev/vercel/lat`. Ten batches cover search, Markdown links, external sources, analysis/performance, graph, navigation, rendering, deployment, hooks/CLI, and development. One out-of-domain query is included to check abstention. Long agent keyword searches and historical terminology are preserved; no query was rewritten after seeing retrieval results.

Search implementation: commit `72fbf5c356f298e9d551c456174059fe16da668b`. The documentation snapshot additionally contains the uncommitted Real query corpus section from the preceding extraction task. The frozen corpus has 506 sections. `corpus.json` records per-file SHA-256 hashes, and `index-meta.json` records model, chunking, lexical normalization, and project fingerprints.

All agents query the same checkpointed index copy using `openIndexedSearchSession`, the shared implementation used by CLI. Settings are local MiniLM, cosine floor 0.2, existing lexical normalization and ranking, top 10. Default CLI results are the first five; ranks six through ten measure whether a larger result list helps. A parity check against the actual current CLI verifies identical top-ten ordering for q001. Timings in raw results are incidental, concurrent-agent measurements and must not be interpreted as a latency benchmark.

### Procedure and rubric

For each query, the assigned agent first runs retrieval, then uses multiple `rg` searches and reads repository documentation, implementation and tests to discover relevant answers independently of the returned list. Every returned section receives a grade: 2 for a direct answer to a substantial part of the interpreted question, 1 for useful partial context/navigation, 0 for incidental or irrelevant content. Grades apply to section content, not merely the document title. Audit text quoting a query is not a direct answer.

Each record contains the interpreted intent, grades and reasons, best existing indexed sections, source/test evidence, grep commands and findings, an overall verdict, and suspected failure modes. `good` means the default five provide a clear useful answer; `partial` means useful material appears but the key answer is missing or obscured; `poor` means the returned set misses existing answers or points to wrong topics; `no_indexed_answer` separates absent/out-of-domain or source-only knowledge from ranking failures. Compound queries may need several sections to answer fully, so one grade-2 section is not equivalent to complete task success.

Report the proportion with at least one direct answer at ranks 1, 5 and 10, mean reciprocal rank of the first direct answer within ten, and direct precision at five. Report all queries and the indexed-answer subset separately. Do not call these exhaustive recall or nDCG: grep-discovered relevant sets are incomplete. A correct empty result for an out-of-domain query is recorded separately from answer retrieval.

### Limits

These are single-agent judgments per query, with root checks, not human relevance labels or an independently adjudicated benchmark. The rubric requires interpreting broad agent intents, and retrieval-first review can anchor judgment despite independent grep. Queries span historical repository states; current documentation may use renamed concepts or omit removed behavior. Existing audit documents can match their own quoted evaluation queries. Selection deliberately balances topics and cannot estimate real traffic-weighted quality. Future formula experiments should preserve this baseline and use a separate held-out set before claiming improvements.
