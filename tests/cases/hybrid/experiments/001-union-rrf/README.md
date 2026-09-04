# Candidate-union rescoring and weighted RRF

Experiment 001 tests ranking changes against a frozen 100-query audit. **Decision: retain the production baseline.** The development winner failed the predeclared validation gate.

## Reproduce and compare

From the repository root, with dependencies installed:

```sh
pnpm experiment:search run
pnpm experiment:search benchmark
```

`run` uses cached complete passage scores and query vectors, calls the actual candidate collector and fusion code, checks historical baseline ordering AND scores for all 100 queries, and writes a new immutable `runs/*.json.gz`. `latest.json` is only a convenience pointer. Every run contains per-query grades/metrics, top-ten rankings, deeper known-target ranks, split, selection decision, and hashes identifying inputs and source. Do not overwrite previous runs or edit a completed experiment's configuration: copy to a new experiment directory and use `--dir`.

`benchmark` restores the exact archived native database into a disposable directory. It checks live/cached ID and score parity, alternates policy execution order, runs 300 engine-only queries per policy with cached query vectors, then 20 warm total queries per policy with local MiniLM. Model startup is excluded. CPU and individual timings are recorded. Run without concurrent tests or builds.

`capture --cache <frozen-cache>` creates immutable scores and database archives for a new directory. Do not capture the current working corpus against these historical judgments. Corpus/index changes require a separately identified baseline and label revalidation. Cached replay is appropriate for candidate/fusion changes; changes to chunking, embeddings, lexical normalization, or the engine require new captures.

## Controls and judgments

- Rollback checkpoint, committed before implementation: `18cc9ce`.
- Historical corpus: `72fbf5c356f298e9d551c456174059fe16da668b` plus `../../real-query-audit/corpus.patch`; every Markdown file has a saved SHA-256 hash.
- 506 sections, 716 passages; engine/model/index versions in the score snapshot's metadata; package versions pinned by the lockfile.
- 990 original judgments + 29 explicitly graded grep-discovered targets + 248 newly surfaced pairs = 1,267 grades. Grade 2 is a direct answer, 1 partial context, 0 irrelevant. New labels include reasons and evidence.
- All 18 variants' top tens are judged. New candidates remain unjudged until reviewed; they never silently receive zero.
- Topic-stratified 80/20 split, fixed seed. Indexed-answer metrics use 73 development and 20 validation queries. All-query metrics and the seven non-indexed-answer cases remain in each run.
- Pooled nDCG uses gains `2^grade - 1`; ideal rankings use all judged sections for each query. This measures quality against the known pool, not exhaustive corpus recall.
- These queries were previously inspected. The validation partition is a consistency check, not an untouched holdout or proof of statistical significance.

## Predeclared grid and result

The 18 policies cross retrieved/union candidates, k=10/20/60, and semantic weight 1/1.5/2 (lexical weight 1). Selection uses development pooled nDCG@5, then direct-answer@5, then MRR@10; exact ties retain configuration order. The chosen winner must not regress on validation nDCG@5 or direct-answer@5. No production change happens automatically.

| Policy | Development nDCG@5 | Validation nDCG@5 | Direct answer @5, indexed queries |
| --- | ---: | ---: | ---: |
| Baseline: retrieved, k=60, equal weights | 0.80455 | 0.84381 | 91/93 |
| Union, k=60, equal weights | 0.80455 | 0.84381 | 91/93 |
| Development winner: retrieved, k=10, equal weights | 0.81307 | 0.84082 | 92/93 |
| Follow-up candidate: retrieved, k=20, semantic 1.5 | 0.81233 | 0.86231 | 92/93 |

The development winner fails validation. The follow-up candidate needs fresh confirmation; choosing it now would tune against validation. Union fills truncated positive channel matches, but provides no top-five quality gain at baseline settings. It preserves true lexical zeroes and the semantic eligibility floor.

The initial uncontended benchmark (`latency-2026-09-04T20-18-06.263Z.json`, Apple M4 Pro) measured engine medians 2.24 ms baseline / 3.74 ms union, and warm total medians 15.69 / 17.72 ms. The committed-code replay (`43c0a1b`) took 0.46 s and its benchmark (`latency-2026-09-04T20-26-09.440Z.json`) measured engine medians 2.95 / 6.05 ms and warm total medians 17.96 / 20.49 ms. Timing varies across runs; both show added cost. These are small-corpus local measurements, not a scaling guarantee. The 20:24 benchmark ran concurrently with tests and is retained only as parity evidence, not a latency comparison.

## Exact index state matters

`index-snapshot.json` links the compressed native database hash to the score snapshot and corpus. In a disposable copy, dropping/recreating only the FTS index changed 336 section lexical maxima for q001; these became identical to a fresh index rebuilt from the frozen Markdown. Semantic section maxima were unchanged. See `index-history-probe.json`. This establishes history-dependent scoring in the observed index, not an upstream root-cause diagnosis. Never mix fresh-index scores with this historical baseline.

## Rollback

The registry records the best validated policy and code checkpoint. To inspect the original checkpoint without discarding current work:

```sh
git worktree add ../lat-rag-baseline 18cc9ce
```

Keep accepted policy changes in separate commits so they can be reverted independently of the experiment harness. This experiment does not change the production policy.

The final committed-code run and validation summary are recorded in `verification.json`: 347 tests passed (one skipped), root/view typechecks passed, and `lat check` passed.
