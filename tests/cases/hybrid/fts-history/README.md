# FTS history-dependent scoring investigation

Turso 0.7.2 reproduces score and ranking changes with identical live rows, independently of Lat's indexing code. The recorded probe identifies deletion history in the FTS index as a concrete source of ranking instability.

## Reproduce

```sh
node --import tsx scripts/probe-fts-history.mjs
node --import tsx scripts/probe-fts-history.mjs --audit > /tmp/fts-history-results.json
```

The first command tests nine SQL sequences in both single-process and multiprocess WAL modes. The optional audit restores the archived experiment index into a disposable directory, reuses captured query vectors, and searches all 100 queries before optimization, after optimization, and after DROP/CREATE. Neither command changes the live project cache. `results.json.gz` preserves row contents, scores, ranks, grades, timings, and source identity.

## Minimal reproduction

Create three rows: `apple banana`, `apple apple`, and `banana pear grape`. Build a whitespace FTS index and query `apple OR banana`. Ten updates setting the second row to its existing text change order from IDs **1,2,3** to **1,3,2**. Rebuilding restores **1,2,3** while table contents remain byte-for-byte equal.

Single same-value UPDATE, INSERT OR REPLACE, and DELETE/reinsert change scores too. Deleting an existing row leaves the surviving rows' scores unchanged until rebuilding. No-op transactions, pure insertions, insert-then-delete within the tested transaction, and rollback match rebuilt scores. Checkpoint/reopen preserves the drift. Both connection modes reproduce it.

## Mechanism and qualification

The pinned [Turso source](https://github.com/tursodatabase/turso/blob/046e9cbf67d22491e8ecc941ec2891b02a9f3cad/core/index_method/fts.rs) configures `NoMergePolicy` (line 3111), deletes by Tantivy term (line 3218), and uses the standard search collector. Its [lockfile](https://github.com/tursodatabase/turso/blob/046e9cbf67d22491e8ecc941ec2891b02a9f3cad/Cargo.lock) pins Tantivy 0.26.1. [Tantivy BM25 statistics](https://docs.rs/tantivy/0.26.1/src/tantivy/query/bm25.rs.html) sum segment `max_doc` and inverted-index token/term statistics, which retain deleted document versions before compaction.

Thus this is a mismatch between our expectation of scores determined by live content and the underlying segment-statistics model. It does not establish corrupt SQL rows or a faulty Lat deletion statement. Lat's section replacement path deletes/reinserts passages on changed sections, so ordinary incremental editing triggers the mechanism even while unchanged embedding hashes are reused.

## Audit impact

On the exact 100-query experiment index, rebuilding FTS changes the top result for **1/100** queries, top-five ordering for **2/100**, and top-ten ordering or membership for **11/100**. All rebuilt top tens already have relevance grades.

The top-result change (q007, chunk hashing/reuse) swaps two directly relevant answers. q025 swaps a direct answer and partial context at positions two/three. Both changed top fives retain the same members; direct-answer presence at five is unchanged. This is real ranking instability, but this sample does not show a large answer-coverage failure or imply rebuilding improves quality universally.

## Repair options

`OPTIMIZE INDEX` restores the small update examples but fails the delete-only example: the pinned implementation returns early when there is only one segment (lines 3492–3497). In the full audit, optimized versus rebuilt top tens differ for 22 queries, so optimization is not a demonstrated equivalent to fresh-index scoring. The reason for that additional discrepancy is not yet isolated.

DROP/CREATE reliably restores the observed baseline for unchanged live rows. The full-corpus probe measured approximately 8 ms to rebuild its 716 lexical passages, without touching embeddings. This is one small-corpus timing, not a scaling benchmark.

Recommended next implementation: rebuild only the derived FTS index inside an indexing transaction whenever existing lexical rows are removed/replaced; keep embedding hash reuse and read-only/no-op paths. Repair previously published indexes once using a versioned maintenance marker. Add integration coverage comparing an incrementally edited project to a fresh index, including deletion-only edits and rollback. Benchmark larger corpora before choosing a less strict periodic policy. No production workaround is applied in this investigation, and the previous ranking experiment remains frozen.
