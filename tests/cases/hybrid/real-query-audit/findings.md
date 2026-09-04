# Per-query findings

All queries are exact strings from local tool history. Grades and grep/source evidence are in judgments.json; raw scores and passage evidence are in results.json.

## q001: how to format links to external source files

**good** — answer availability: `indexed`.

Best answer appears at rank 3; rank 1 is neighboring local-source syntax. External Link Syntax / Resolution Rules is also useful but absent from top 10.

- `lat.md/external-sources#External Sources#Link Syntax` — rank 3; Gives handle:path#fragment syntax and code-symbol examples.
- `lat.md/external-sources#External Sources#Link Syntax#Resolution Rules` — outside top 10; Useful additional answer section independently found with rg; not returned in top 10.

## q002: how to add images in wiki

**good** — answer availability: `indexed`.

Direct answer ranks first. Ranks 2–3 are self-referential search evaluation text; this success is contaminated by documentation added in response to the identical historical question. Image tests remain below top 5.

- `lat.md/markdown#Markdown#Images` — rank 1; Exact authoring syntax, asset placement, clickable images, and wiki/image distinction.

## q003: banana recipes and tropical weather

**no_indexed_answer** — answer availability: `absent`.

No results returned: correct abstention. Extensive repository search found none of the requested subject matter.


## q004: Application-side stemming option

**good** — answer availability: `indexed`.

Excellent top result and direct test at rank 3. Expanded results confuse linguistic stemming with filename stems. Historical word option is now a shipped policy, not a user toggle.

- `lat.md/search-design#Search Redesign#Evaluation and delivery#Application-side stemming` — rank 1; Direct implementation/package/tokenization description.

## q005: RAG search embeddings chunking ranking backlinks

**good** — answer availability: `indexed`.

Default five cover chunking, authority status, and fusion. Rank 1 is a narrow test rather than the design overview at rank 8; useful coverage still exists.

- `lat.md/search-design#Search Redesign#Chunk boundaries` — rank 2; Direct chunking strategy.
- `lat.md/search-design#Search Redesign#Backlink prior` — rank 3; Explicitly says backlinks are deferred and offers planned formula.
- `lat.md/cli#CLI#search#Vector Search` — rank 5; Direct retrieval and fusion architecture.

## q006: Search Redesign storage chunking retrieval

**good** — answer availability: `indexed`.

Strong coverage: first four results answer all requested aspects.

- `lat.md/search-design#Search Redesign#Chunk boundaries` — rank 1; Detailed chunk policy and oversized fallbacks.
- `lat.md/search-design#Search Redesign#Storage and migration` — rank 3; Direct tables, Turso constraints, and migration.
- `lat.md/search-design#Search Redesign#Candidate retrieval and fusion` — rank 4; Direct candidate collapse and RRF formula.

## q007: chunk hash incremental embedding reuse indexing performance

**good** — answer availability: `indexed`.

Direct design and measured performance rank 1–2, with regression coverage rank 5.

- `lat.md/search-design#Search Redesign#Incremental indexing` — rank 1; Exact cache guarantee, invalidation, limitations, planned optimization.
- `lat.md/search-audit#Retrieval Tuning Assessment#Indexing performance` — rank 2; Measured full/incremental comparison and profiling.
- `lat.md/tests/search#Search#Hybrid Retrieval#Reuses unchanged chunks within edited sections` — rank 5; Direct within-section reuse test.

## q008: cosine similarity score range negative values vector search formula

**partial** — answer availability: `indexed`.

Top five explain hybrid versus cosine but do not state cosine range or why negatives occur. No indexed section found documenting the complete mathematical question. Source implements 1-vector_distance_cos and rejects min-similarity outside 0..1; this is a partial documentation gap rather than a proven missed answer.

- `lat.md/cli#CLI#search#Vector Search` — rank 1; Explains current fusion formula but not cosine mathematical range.
- `lat.md/search-design#Search Redesign#Result contract` — rank 5; Score contract distinguishes hybrid from cosine; no full cosine range.
- `lat.md/search-design#Search Redesign#Candidate retrieval and fusion` — outside top 10; Useful additional answer section independently found with rg; not returned in top 10.

## q009: oversized Markdown chunk boundaries fallback

**good** — answer availability: `indexed`.

Exact design answer ranks first. Complete passage coverage test is absent from top 10; other eight results mostly match Markdown or boundaries without answering.

- `lat.md/search-design#Search Redesign#Chunk boundaries` — rank 1; Exact fallback order for prose, lists, code, tables, Unicode and impossible-fit errors.
- `lat.md/tests/search#Search#Hybrid Retrieval#Preserves complete passage coverage` — outside top 10; Useful additional answer section independently found with rg; not returned in top 10.

## q010: stored embedding model local remote mismatch reindex prompt backend selection database vectors

**good** — answer availability: `indexed`.

Default five cover interactive and noninteractive mismatches plus authoritative model selection. Strong relevant cluster; reindex reference appears at rank 6.

- `lat.md/tests/init#Init#Embedding setup#Backend mismatch offers reindexing` — rank 1; Direct interactive mismatch prompt specification.
- `lat.md/cli#CLI#search#Backend selection` — rank 2; Authoritative stored model and mismatch errors.
- `lat.md/cli#CLI#reindex` — rank 6; Explicit migration/backend selection behavior.

## q011: Obsidian GitHub heading slug markdown fragment compatibility

**good** — answer availability: `indexed`.

The first five all address fragment compatibility; adjacent GitHub-surface noise appears only below the default cutoff.

- `lat.md/tests/check-links#Check Links#Rejects non-GitHub heading fragments` — rank 1; Direct documentation of compare ordinary-link github fragment rules with obsidian-compatible wiki and cli heading resolution.
- `lat.md/markdown#Markdown#Wiki Links#Resolution Rules` — rank 3; Direct documentation of compare ordinary-link github fragment rules with obsidian-compatible wiki and cli heading resolution.
- `lat.md/parser#Parser#Short Ref Resolution` — outside top 10; Direct documentation of compare ordinary-link github fragment rules with obsidian-compatible wiki and cli heading resolution.

## q012: allow optional md extension on local and external wiki links external source default file extension schema validation implicit path resolution

**partial** — answer availability: `indexed`.

External rules rank 3, but local optional-.md rules rank 6 and configuration schema is outside top 10. Top 1–2 answer arbitrary repository paths instead. Their semantic ranks are 3 and 1; local Resolution Rules semantic rank 15 and lexical rank 6. This is a compound-query coverage miss, not evidence of candidate exclusion.

- `lat.md/markdown#Markdown#Wiki Links#Resolution Rules` — rank 6; Direct documentation of determine optional .md rules for local and external links, configured default extensions, and validation.
- `lat.md/external-sources#External Sources#Link Syntax#Resolution Rules` — rank 3; Direct documentation of determine optional .md rules for local and external links, configured default extensions, and validation.
- `lat.md/external-sources#External Sources#Canonical Configuration` — outside top 10; Direct documentation of determine optional .md rules for local and external links, configured default extensions, and validation.

## q013: allow wiki links to arbitrary repository files and directories validate existence unsupported formats navigation

**good** — answer availability: `indexed`.

Excellent default results: rank 2 explicitly distinguishes validation from ability to open unsupported formats.

- `lat.md/markdown#Markdown#Wiki Links#Repository Path Links` — rank 2; Direct documentation of can fragmentless wiki links point to arbitrary existing repository files/directories, and which targets are navigable?
- `lat.md/tests/check-md#Check MD#Passes with valid links#Accepts repository path links` — rank 1; Direct documentation of can fragmentless wiki links point to arbitrary existing repository files/directories, and which targets are navigable?

## q014: difference ordinary markdown relative links wiki links section anchors refs graph validation

**partial** — answer availability: `indexed`.

Resolution and validation are covered, but the explicit graph clause is missing: Graph semantics/Edges states both ordinary and wiki links create graph edges and is absent from top 10. Useful partial answer to the compound intent, not poor overall.

- `lat.md/markdown#Markdown#Relative Links` — rank 1; Direct documentation of compare ordinary relative markdown and wiki links across resolution/anchors, refs, and graph participation.
- `lat.md/markdown#Markdown#Wiki Links` — rank 5; Direct documentation of compare ordinary relative markdown and wiki links across resolution/anchors, refs, and graph participation.
- `lat.md/view/graph#Graph View#Graph semantics#Edges` — outside top 10; Direct documentation of graph edge participation for both link types

## q015: escaping opening bracket prevents Markdown shortcut reference link parsing

**good** — answer availability: `indexed`.

Ranks 1–2 directly answer; rank 6 is misleading lexical overlap on backslashes but outside top 5.

- `lat.md/tests/check-links#Check Links#Rejects undefined shortcut references` — rank 1; Direct documentation of how to escape literal bracket text so it does not become an undefined markdown shortcut reference.
- `lat.md/markdown#Markdown#Relative Links` — rank 2; Direct documentation of how to escape literal bracket text so it does not become an undefined markdown shortcut reference.

## q016: heading fragment resolution markdown links wiki links section command slug compatibility validation tests

**good** — answer availability: `indexed`.

Strong core heading-compatibility answers at ranks 1,2,5. Exact CLI section-command spec is missing from top 10, so compound subtopic coverage could improve.

- `lat.md/tests/check-links#Check Links#Rejects non-GitHub heading fragments` — rank 1; Direct documentation of find behavior and validation tests for literal vs slug heading resolution in wiki/ordinary links and section commands.
- `lat.md/tests/ref-resolution#Ref Resolution#Wiki links accept literal and GitHub headings` — rank 5; Direct documentation of find behavior and validation tests for literal vs slug heading resolution in wiki/ordinary links and section commands.
- `lat.md/tests/section#Section#CLI accepts literal and GitHub heading syntax` — outside top 10; Direct documentation of find behavior and validation tests for literal vs slug heading resolution in wiki/ordinary links and section commands.

## q017: lat check Markdown packed reference definitions multiple definitions one line missed broken links

**good** — answer availability: `indexed`.

Specific current behavior is at rank 2; source fixtures and assertions confirm packed definitions are detected. Historical query wording describes a fixed issue, not a current failure.

- `lat.md/tests/check-links#Check Links#Rejects undefined shortcut references` — rank 2; Direct documentation of does lat check catch packed same-line markdown reference definitions rather than silently missing broken links?

## q018: ordinary Markdown links require GitHub heading fragments wiki links accept both formats test spec

**good** — answer availability: `indexed`.

All default results contribute directly; especially clean success for a precise behavior-and-test query.

- `lat.md/tests/check-links#Check Links#Rejects non-GitHub heading fragments` — rank 1; Direct documentation of find tests establishing ordinary markdown github-only fragments and wiki acceptance of both heading forms.
- `lat.md/tests/ref-resolution#Ref Resolution#Wiki links accept literal and GitHub headings` — rank 2; Direct documentation of find tests establishing ordinary markdown github-only fragments and wiki acceptance of both heading forms.

## q019: section ids heading matching normalization wiki links slug anchors duplicate headings unicode punctuation

**good** — answer availability: `indexed`.

Core normalization and duplicates are answered in default results. Parser Short Ref Resolution is absent from top 10. No dedicated indexed Unicode policy found; source delegates slug formation to github-slugger, so do not infer a retrieval miss for an undocumented Unicode contract.

- `lat.md/markdown#Markdown#Wiki Links#Resolution Rules` — rank 9; Direct documentation of how heading ids normalize literal/slug paths, duplicate headings and punctuation; seek unicode handling too.
- `lat.md/parser#Parser#Short Ref Resolution` — outside top 10; Direct documentation of how heading ids normalize literal/slug paths, duplicate headings and punctuation; seek unicode handling too.
- `lat.md/tests/check-links#Check Links#Accepts GitHub heading fragments` — rank 4; Direct documentation of how heading ids normalize literal/slug paths, duplicate headings and punctuation; seek unicode handling too.

## q020: wiki link grammar parser alias divider source code links resolution external handle prefix colon fragment

**good** — answer availability: `indexed`.

Excellent parser/source navigation: all top five address substantial query parts, with actual tokenizer and resolver source confirming docs.

- `lat.md/external-sources#External Sources#Link Syntax#Parser Integration` — rank 1; Direct documentation of locate wiki grammar and alias parsing, plus external handle: paths and fragment/source-symbol resolution.
- `lat.md/external-sources#External Sources#Link Syntax` — rank 2; Direct documentation of locate wiki grammar and alias parsing, plus external handle: paths and fragment/source-symbol resolution.
- `lat.md/parser#Parser#Wiki Links#Wiki Link Node` — rank 5; Direct documentation of locate wiki grammar and alias parsing, plus external handle: paths and fragment/source-symbol resolution.

## q021: external AsciiDoc fragment aliases underscore slug heading IDs local checkout validation goufs

**good** — answer availability: `indexed`.

Direct alias answer appears at rank 3, validation at 2; rank 1 and 5 confuse Markdown slug validation with AsciiDoc. No goufs occurrence found in source/tests.

- `lat.md/external-sources#External Sources#Link Syntax#Parser Integration` — rank 3; Directly establishes asciiDoc generated and explicit heading aliases, underscore preservation, and validation against local checkout. The historical token goufs is not a documented feature.
- `lat.md/external-sources#External Sources#Command Integration#Validation` — rank 2; Directly establishes asciiDoc generated and explicit heading aliases, underscore preservation, and validation against local checkout. The historical token goufs is not a documented feature.

## q022: external cache metadata local strategy local-path delete sibling cache directory external link resolution

**good** — answer availability: `indexed`.

Ranks 1–3 collectively give exact lifecycle and its tests.

- `lat.md/external-sources#External Sources#Cache and Invalidation#Cache Layout` — rank 2; Directly establishes how local provider selection changes metadata and removes the adjacent fetched/checkout cache directory.
- `lat.md/external-sources#External Sources#Cache and Invalidation#Cache Invalidation` — rank 1; Directly establishes how local provider selection changes metadata and removes the adjacent fetched/checkout cache directory.

## q023: external link extensionless markdown path unsupported file extension exact repository path

**partial** — answer availability: `indexed`.

External answer is partly at rank 5 but precise rules at 8. Top three favor local paths, which accept unsupported formats that external references reject. Intent is somewhat ambiguous; judgment prioritizes initial external-link scope.

- `lat.md/external-sources#External Sources#Link Syntax#Resolution Rules` — rank 8; Directly establishes whether external references require supported extensions or infer Markdown/default extensions, contrasted with exact local repository paths.
- `lat.md/external-sources#External Sources#Link Syntax` — rank 5; Directly establishes whether external references require supported extensions or infer Markdown/default extensions, contrasted with exact local repository paths.
- `lat.md/external-sources#External Sources#Known Limitations` — outside top 10; Directly establishes whether external references require supported extensions or infer Markdown/default extensions, contrasted with exact local repository paths.

## q024: external source cache directory per handle sidecar commit invalidation valid handle names prefix strategy fetch URL

**good** — answer availability: `indexed`.

Top five cover all central subquestions with exact policy.

- `lat.md/external-sources#External Sources#Cache and Invalidation#Cache Layout` — rank 2; Directly establishes per-handle cache metadata layout and invalidation, including valid handle names and provider URL selection.
- `lat.md/external-sources#External Sources#Canonical Configuration#Source Names` — rank 5; Directly establishes per-handle cache metadata layout and invalidation, including valid handle names and provider URL selection.
- `lat.md/external-sources#External Sources#Cache and Invalidation#Cache Invalidation` — rank 1; Directly establishes per-handle cache metadata layout and invalidation, including valid handle names and provider URL selection.

## q025: external source error messages diagnostics clarity actionable configuration retrieval failures

**partial** — answer availability: `indexed`.

Useful high-level failure handling is present, but clearest actionable examples (bad placeholder, HTML raw URL, remote mismatch, HTTP path/status) are absent from top 10.

- `lat.md/external-sources#External Sources#Canonical Configuration#Fetch URL Resolution` — outside top 10; Directly establishes which actionable configuration and retrieval diagnostics external sources produce and how users can repair failures.
- `lat.md/external-sources#External Sources#Retrieval Providers#Raw HTTP` — outside top 10; Directly establishes which actionable configuration and retrieval diagnostics external sources produce and how users can repair failures.
- `lat.md/external-sources#External Sources#Local Overrides#Merge Semantics` — outside top 10; Directly establishes which actionable configuration and retrieval diagnostics external sources produce and how users can repair failures.

## q026: external source fragments RST reStructuredText line ranges named headings code symbols content drift

**good** — answer availability: `indexed`.

Rank 1 answers the core stability decision exactly; rank 2 gives supported kinds. RST-specific aliases only at 7.

- `lat.md/external-sources#External Sources#Design Boundaries#Stable Fragments` — rank 1; Directly establishes external fragment types and why named RST headings/symbols are supported while physical line ranges are rejected.
- `lat.md/external-sources#External Sources#Link Syntax#Parser Integration` — rank 7; Directly establishes external fragment types and why named RST headings/symbols are supported while physical line ranges are rejected.

## q027: external source repository subdirectory root path monorepo short links sparse checkout source handle

**partial** — answer availability: `indexed`.

Checkout side of question is answered, but exact prefix-to-path mapping ranks 9 and canonical prefix configuration is absent. Ranks 4–7 are misleading local-path topics.

- `lat.md/external-sources#External Sources#Link Syntax#Resolution Rules` — rank 9; Directly establishes how repository prefix scopes external links to a monorepo subdirectory, and how checkout suggestions use that prefix.
- `lat.md/external-sources#External Sources#Canonical Configuration` — outside top 10; Directly establishes how repository prefix scopes external links to a monorepo subdirectory, and how checkout suggestions use that prefix.
- `lat.md/external-sources#External Sources#Command Surface#Show and List` — outside top 10; Directly establishes how repository prefix scopes external links to a monorepo subdirectory, and how checkout suggestions use that prefix.

## q028: external source strategy fetch checkout fetch-url template validation commit path placeholders GitHub GitLab inference

**good** — answer availability: `indexed`.

Top result is the precise answer; next four cover strategy and practical configuration.

- `lat.md/external-sources#External Sources#Canonical Configuration#Fetch URL Resolution` — rank 1; Directly establishes fetch versus checkout strategy and validation/inference of raw URL templates with commit/path placeholders.
- `lat.md/external-sources#External Sources#Canonical Configuration` — rank 2; Directly establishes fetch versus checkout strategy and validation/inference of raw URL templates with commit/path placeholders.

## q029: external sources supported document formats markdown parser file extensions section anchors reStructuredText AsciiDoc

**good** — answer availability: `indexed`.

Strong documentation and tests in top 4; exact extension list remains in canonical configuration outside top 10, but core format question is answered.

- `lat.md/external-sources#External Sources#Link Syntax#Parser Integration` — rank 2; Directly establishes supported external document formats, section-anchor extraction and parser architecture.
- `lat.md/external-sources#External Sources#Known Limitations` — rank 7; Directly establishes supported external document formats, section-anchor extraction and parser architecture.

## q030: get-source command remote repository URL pinned revision local override agent clone command sparse checkout external source resolution

**partial** — answer availability: `indexed`.

Top two identify correct command, but exact output/checkout description and explicit no-get-source statement are absent from top 10; local override details begin at rank 6. No obsolete command is assumed to exist.

- `lat.md/external-sources#External Sources#Command Surface` — outside top 10; Directly establishes find the source-inspection command, pinned repository/local override metadata, and suggested editable sparse checkout; historical get-source naming may be obsolete.
- `lat.md/external-sources#External Sources#Command Surface#Show and List` — outside top 10; Directly establishes find the source-inspection command, pinned repository/local override metadata, and suggested editable sparse checkout; historical get-source naming may be obsolete.
- `lat.md/external-sources#External Sources#Local Overrides#Merge Semantics` — rank 7; Directly establishes find the source-inspection command, pinned repository/local override metadata, and suggested editable sparse checkout; historical get-source naming may be obsolete.

## q031: Markdown analysis worker executor bounded queue worker count implementation detail performance

**good** — answer availability: `indexed`.

Strong top result. Exact count formula is only in source, but scheduling architecture and linked implementation are readily found.

- `lat.md/architecture-analysis#Parsed Analysis#Execution` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/cli#CLI#check` — rank 7; Direct architecture or behavioral specification for the interpreted intent.

## q032: TypeScript fallback bounded worker pool parallel file reads code reference scanning performance

**good** — answer availability: `indexed`.

Precise behavior spec first and architecture second. Lower results drift to unrelated Markdown/embedding performance.

- `lat.md/tests/ts-fallback#TS Fallback#Bounded pool preserves source order` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/dev-process#Dev Process#File Walking` — rank 2; Direct architecture or behavioral specification for the interpreted intent.

## q033: central supported source file extensions parser languages code mentions ripgrep fallback test coverage

**good** — answer availability: `indexed`.

Good: both scanner registry and parser fixture answers in top two. Actual extension list and architecture are ranks 6 and 7, a minor breadth issue for compound query.

- `lat.md/tests/check-code-refs#Check Code Refs#Scans only supported source files` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/tests/analysis-tests#Parser Analysis Tests#Caches every supported source language` — rank 2; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/architecture-analysis#Parsed Analysis#Source analysis` — rank 7; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/markdown#Markdown#Wiki Links#Source Code Links` — rank 6; Direct architecture or behavioral specification for the interpreted intent.

## q034: check profile parser cache external document timing metrics

**good** — answer availability: `indexed`.

Strong result set. External-specific spec only rank 8, but rank 1 already answers external timing behavior.

- `lat.md/cli#CLI#check` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/tests/check-headless#Check Explicit Directories#Profiles validation work` — rank 3; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/tests/external-tests#External Sources#Persistent document analysis cache` — rank 8; Direct architecture or behavioral specification for the interpreted intent.

## q035: check validators run concurrently source grepping project analysis

**good** — answer availability: `indexed`.

Top two answer core intent directly. Project snapshot is outside top 10 but linked by rank 1; no important miss.

- `lat.md/cli#CLI#check` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/tests/check-headless#Check Explicit Directories#Reuses check data across validators` — rank 2; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/architecture-analysis#Parsed Analysis#Project snapshot` — outside top 10; Direct architecture or behavioral specification for the interpreted intent.

## q036: directory walking ignore-walk gitignore ripgrep fallback performance file discovery

**good** — answer availability: `indexed`.

Correct architecture first, relevant parity/ignore tests next. Lower ranks drift to incidental ignore/file-tree words.

- `lat.md/dev-process#Dev Process#File Walking` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/tests/ts-fallback#TS Fallback#Matches ripgrep discovery semantics` — rank 2; Direct architecture or behavioral specification for the interpreted intent.

## q037: how lat finds lat.md directory symlink project root discovery

**partial** — answer availability: `indexed`.

Useful rank 1, but explicit symlink nuance is source-only and results 2-6 offer little help. Do not mistake walker symlink exclusion for root-discovery rejection.

- `lat.md/dev-process#Dev Process#File Walking` — rank 1; Direct architecture or behavioral specification for the interpreted intent.

## q038: parsed cache filename hash prefix full path identity collision readable suffix content hash

**good** — answer availability: `indexed`.

Exact spec first and full architecture second. Rank 3 is a clear lexical false positive around hash/path wording.

- `lat.md/tests/analysis-tests#Parser Analysis Tests#Uses collision-safe sharded cache paths` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/architecture-analysis#Parsed Analysis#Persistent cache` — rank 2; Direct architecture or behavioral specification for the interpreted intent.

## q039: parser cache version first-line version content hash invalidation serialized markdown analysis

**good** — answer availability: `indexed`.

Strong exact answer first; top five cover implementation contract and verification. Related source test outranks exact Markdown test but causes little friction.

- `lat.md/architecture-analysis#Parsed Analysis#Persistent cache` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/tests/analysis-tests#Parser Analysis Tests#Invalidates changed content and cache schemas` — rank 3; Direct architecture or behavioral specification for the interpreted intent.

## q040: source file discovery API code reference scanning UI live update scope ripgrep fallback

**good** — answer availability: `indexed`.

Excellent compound-query coverage: API spec first, architecture third, GUI live-index fifth. External source/sidebar sections at 9-10 are lexical ambiguity noise.

- `lat.md/tests/check-code-refs#Check Code Refs#Scans only supported source files` — rank 1; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/dev-process#Dev Process#File Walking` — rank 3; Direct architecture or behavioral specification for the interpreted intent.
- `lat.md/view/architecture#Browser Architecture#Live project index` — rank 5; Direct architecture or behavioral specification for the interpreted intent.

## q041: graph ForceAtlas animation layout worker settled positions

**good** — answer availability: `indexed`.

Historical ForceAtlas premise is obsolete; first result clearly corrects it. Detailed ring/cluster explanation exists in Client and selection, outside top 10, but returned specs already answer the central question.

- `lat.md/view/specs#View Tests#Renders the graph workspace` — rank 1; Direct explanation of a substantial query component.
- `lat.md/view/architecture#Browser Architecture#Graph workspace` — rank 2; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Server projection` — rank 5; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Client and selection` — outside top 10; Direct explanation of a substantial query component.

## q042: graph document nodes blue code nodes orange category colors Sigma legend

**good** — answer availability: `indexed`.

Rank 1 answers exact colors; legend checkbox implementation confirmed in source.

- `lat.md/view/graph#Graph View#Client and selection` — rank 1; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Initial scope` — rank 10; Direct explanation of a substantial query component.

## q043: graph instant render cached layout semantic embeddings search filter graph nodes

**good** — answer availability: `indexed`.

Multiple direct top-5 answers cover both halves; server implementation detail is not needed to regard retrieval as successful.

- `lat.md/view/specs#View Tests#Renders the graph workspace` — rank 1; Direct explanation of a substantial query component.
- `lat.md/view/architecture#Browser Architecture#Graph workspace` — rank 2; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Client and selection` — rank 9; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Server projection` — outside top 10; Direct explanation of a substantial query component.

## q044: graph mode inspector links should remain in graph select nodes in place sticky graph route navigation

**good** — answer availability: `indexed`.

First three results answer the requested interaction directly.

- `lat.md/view/graph#Graph View#Client and selection` — rank 1; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Product shape` — rank 2; Direct explanation of a substantial query component.
- `lat.md/view/specs#View Tests#Renders the graph workspace` — rank 3; Direct explanation of a substantial query component.

## q045: graph node label breadcrumbs context disambiguation

**no_indexed_answer** — answer availability: `source_only`.

Exact behavior exists in graphDisplayLabel: preceding breadcrumb for normal nodes, source parent directory for code-reference nodes. No indexed prose specifies it; this is not evidence that reranking would recover the answer.

- `lat.md/view/graph#Graph View#Graph semantics#Nodes` — rank 1; Closest indexed context; exact breadcrumb algorithm is source-only.
- `lat.md/view/specs#View Tests#Renders the graph workspace` — rank 5; Closest indexed context; exact breadcrumb algorithm is source-only.
- `lat.md/view/graph#Graph View#Client and selection` — rank 6; Closest indexed context; exact breadcrumb algorithm is source-only.

## q046: graph presentation mode localStorage normal document source URLs browser history toggle persisted static base namespace

**good** — answer availability: `indexed`.

First two results directly answer persistence and history; source/tests establish exact namespace key.

- `lat.md/view/specs#View Tests#Renders the graph workspace` — rank 1; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Product shape` — rank 2; Direct explanation of a substantial query component.

## q047: graph search resize visible nodes by semantic hit score while filtering results

**good** — answer availability: `indexed`.

Direct results at ranks 1–3. Client and selection still says cosine while current source and Result contract use rankScore; content consistency issue, not missing retrieval.

- `lat.md/view/specs#View Tests#Renders the graph workspace` — rank 1; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Client and selection` — rank 2; Direct explanation of a substantial query component.
- `lat.md/search-design#Search Redesign#Result contract` — rank 3; Direct explanation of a substantial query component.

## q048: graph section nodes document code node size backlinks label rendering

**good** — answer availability: `indexed`.

Strong top-5 coverage across all parts of compound query; obsolete section-node assumption corrected.

- `lat.md/view/graph#Graph View#Graph semantics#Nodes` — rank 1; Direct explanation of a substantial query component.
- `lat.md/view/specs#View Tests#Renders the graph workspace` — rank 2; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Client and selection` — rank 4; Direct explanation of a substantial query component.

## q049: graph view documents linked sections source code references split inspector route architecture

**good** — answer availability: `indexed`.

Top result is shallow overview, but ranks 2,4,5 directly answer substantial architecture; good default result set.

- `lat.md/view/architecture#Browser Architecture#Graph workspace` — rank 2; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Product shape` — rank 4; Direct explanation of a substantial query component.
- `lat.md/view/specs#View Tests#Renders the graph workspace` — rank 5; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Client and selection` — rank 8; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Server projection` — outside top 10; Direct explanation of a substantial query component.

## q050: section back references count distinct linking paragraphs wiki code locations

**good** — answer availability: `indexed`.

Ranks 1–2 answer exact distinct-location semantics despite character-count noise at ranks 5 and 7.

- `lat.md/view/architecture#Browser Architecture#Wiki-link reference counts` — rank 1; Direct explanation of a substantial query component.
- `lat.md/view/specs#View Tests#Resolves Markdown and source wiki links` — rank 2; Direct explanation of a substantial query component.
- `lat.md/view/graph#Graph View#Graph semantics#Nodes` — outside top 10; Direct explanation of a substantial query component.
- `lat.md/view/specs#View Tests#Shows section back-references` — rank 10; Direct explanation of a substantial query component.

## q051: Firefox refs label heading context panel opens then closes delayed refresh selection state

**poor** — answer availability: `ambiguous`.

Best current navigation sections are absent from top 10. Exact Firefox root cause remains unverified; this is a failure to find useful menu/refresh context, not proof that the historical bug has an indexed diagnosis.

- `lat.md/view/specs#View Tests#Shows section back-references` — outside top 10; Best available menu, rendering lifecycle or refresh context; not a Firefox-specific root-cause diagnosis.
- `lat.md/view/architecture#Browser Architecture#Markdown navigation` — outside top 10; Best available menu, rendering lifecycle or refresh context; not a Firefox-specific root-cause diagnosis.
- `lat.md/view/specs#View Tests#Updates long-running views incrementally` — outside top 10; Best available menu, rendering lifecycle or refresh context; not a Firefox-specific root-cause diagnosis.
- `lat.md/view/architecture#Browser Architecture#Document tree protocol` — outside top 10; Best available menu, rendering lifecycle or refresh context; not a Firefox-specific root-cause diagnosis.

## q052: H1 page TOC click scroll document to top fragment navigation

**good** — answer availability: `indexed`.

Exact answer first, independently confirmed by test and call site.

- `lat.md/view/specs#View Tests#Stabilizes fragment navigation immediately` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/architecture#Browser Architecture#Markdown navigation` — rank 2; Relevant existing specification or architecture for the interpreted behavior.

## q053: Safari back swipe history scroll restoration page temporarily hidden interaction

**good** — answer availability: `indexed`.

Good for the underlying behavior; no Safari-specific diagnosis is asserted.

- `lat.md/view/specs#View Tests#Restores history scroll positions` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/architecture#Browser Architecture#Search and history` — rank 2; Relevant existing specification or architecture for the interpreted behavior.

## q054: browser search query history back button URL state

**good** — answer availability: `indexed`.

Correct architecture ranked first, with direct history test specification third.

- `lat.md/view/architecture#Browser Architecture#Search and history` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/specs#View Tests#Restores history scroll positions` — rank 3; Relevant existing specification or architecture for the interpreted behavior.

## q055: code view context highlighted lines collapse non-highlighted code buffer expand

**good** — answer availability: `indexed`.

Exact answer first and architecture second. Later keyword-overlap results are mostly irrelevant.

- `lat.md/view/specs#View Tests#Places context within a collapsed source window` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/architecture#Browser Architecture#Source navigation` — rank 2; Relevant existing specification or architecture for the interpreted behavior.

## q056: expanding collapsed source lines preserve scroll position above

**good** — answer availability: `indexed`.

Direct implementation concept and specification ranked first two.

- `lat.md/view/specs#View Tests#Places context within a collapsed source window` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/architecture#Browser Architecture#Source navigation` — rank 2; Relevant existing specification or architecture for the interpreted behavior.

## q057: history scroll restoration back navigation

**good** — answer availability: `indexed`.

Correct spec and architecture rank first and second.

- `lat.md/view/specs#View Tests#Restores history scroll positions` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/architecture#Browser Architecture#Search and history` — rank 2; Relevant existing specification or architecture for the interpreted behavior.

## q058: lat view protocol document metadata frontmatter require code mention browser rendering tests

**good** — answer availability: `indexed`.

Exact test contract is first despite many broad incidental hits.

- `lat.md/view/specs#View Tests#Exposes code-mention frontmatter as metadata` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/architecture#Browser Architecture#Document tree protocol` — rank 10; Relevant existing specification or architecture for the interpreted behavior.

## q059: same-document fragment navigation table of contents repaint remount hash links client router

**good** — answer availability: `indexed`.

Direct answers occupy first two slots; richer lifecycle-specific child is rank six but parent already addresses core intent.

- `lat.md/view/specs#View Tests#Stabilizes fragment navigation immediately` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/architecture#Browser Architecture#Markdown navigation` — rank 2; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/specs#View Tests#Stabilizes fragment navigation immediately#Preserves rich renderers` — rank 6; Relevant existing specification or architecture for the interpreted behavior.

## q060: sidebar validation error marker directory ancestor propagation

**good** — answer availability: `indexed`.

Exact indexed answer ranked first. Ranks 2-10 mostly drift toward generic CLI validation rather than tree propagation.

- `lat.md/view/specs#View Tests#Shows live validation errors` — rank 1; Relevant existing specification or architecture for the interpreted behavior.
- `lat.md/view/specs#View Tests#Builds a nested file tree` — outside top 10; Relevant existing specification or architecture for the interpreted behavior.

## q061: Markdown local linked resources images static UI export copy assets

**good** — answer availability: `indexed`.

Strong coverage despite the most precise copy-once test ranking eighth.

- `lat.md/view/specs#View Tests#Builds a static deployment` — rank 8; Direct resource-copy behavior specification.
- `lat.md/view/architecture#Browser Architecture#Build targets#Static export` — rank 2; Static output retains resource paths.
- `lat.md/markdown#Markdown#Relative Links` — rank 3; Local resource validity, serving and export rules.

## q062: UI markdown code blocks clipboard copy button

**good** — answer availability: `indexed`.

Top four jointly answer implementation, behavior, and tests.

- `lat.md/view/specs#View Tests#Copies code blocks` — rank 1; Core copy-control behavior.
- `lat.md/view/specs#View Tests#Copies code blocks#Copies plain and highlighted text` — rank 3; Exact text, whitespace and static behavior.
- `lat.md/view/architecture#Browser Architecture#Document tree protocol` — rank 4; Architecture names CodeBlock implementation and coverage.

## q063: browser segmented wiki link underline color rendering and view tests

**partial** — answer availability: `indexed`.

Direct underline architecture is rank 7; exact segmentation test spec misses top 10. Default results mostly neighboring wiki-link subjects.

- `lat.md/view/architecture#Browser Architecture#Markdown navigation` — rank 7; Direct underline rule and undecorated badges.
- `lat.md/view/specs#View Tests#Resolves Markdown and source wiki links` — outside top 10; Precise documented requested behavior.

## q064: code file language icon prevent line break before first word link label whitespace wrapping browser

**good** — answer availability: `indexed`.

Exact answer appears at rank 5, but fenced-code highlighting incorrectly ranks first.

- `lat.md/view/specs#View Tests#Resolves Markdown and source wiki links` — rank 5; Exactly specifies badge bound to first word.

## q065: current Markdown reference definition rendering muted list compact monospace label badges URL title validation Git annotations

**no_indexed_answer** — answer availability: `ambiguous`.

Historical desired UI is not documented as current behavior; do not blame ranking for absent styling feature. Validation aspect exists elsewhere, but is not the main intent.


## q066: git diff inline word overlap threshold line blocks rewritten paragraph

**good** — answer availability: `indexed`.

Exact answers at 1 and 3; remaining list largely hook threshold collisions.

- `lat.md/view/architecture#Browser Architecture#Git working tree` — rank 1; Gives 60% ordered-token overlap rule.
- `lat.md/view/specs#View Tests#Shows live Git state` — rank 3; Exact behavior plus table/math treatment.

## q067: iPhone mobile horizontal overflow rendered markdown code blocks document column viewport

**good** — answer availability: `indexed`.

Mobile behavior and architecture both in default results.

- `lat.md/view/specs#View Tests#Adapts navigation to mobile screens` — rank 1; Direct mobile wrapping and local code-scroll behavior.
- `lat.md/view/architecture#Browser Architecture#Responsive layout` — rank 4; Direct responsive overflow policy.

## q068: local table of contents include document top-level title h1 first entry no indentation bold

**good** — answer availability: `indexed`.

Both precise indexed answers ranked first and second.

- `lat.md/view/architecture#Browser Architecture#Markdown navigation` — rank 1; Exact H1 indentation/bold rule.
- `lat.md/view/specs#View Tests#Shows a local table of contents` — rank 2; Direct TOC specification.

## q069: local table of contents scroll sync short sections active heading bottom of document

**good** — answer availability: `indexed`.

Direct behavioral and implementation navigation answers at 1 and 2.

- `lat.md/view/specs#View Tests#Shows a local table of contents` — rank 1; Short final sections activate in sequence.
- `lat.md/view/architecture#Browser Architecture#Markdown navigation` — rank 2; Moving end-of-page activation line explained.

## q070: table of contents icon open source license UI icon style

**no_indexed_answer** — answer availability: `source_only`.

Source gives unambiguous answer; search indexes documentation sections, so this is a coverage gap rather than a missed indexed answer.


## q071: static UI JSON payload CDN caching server deployment document data manifest performance

**good** — answer availability: `indexed`.

Default top five contain a clear direct answer. Grades distinguish implementation-specific answers from adjacent context.

- `lat.md/view/architecture#Browser Architecture#Build targets#Static export` — rank 1; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a static deployment` — rank 2; Directly documents the requested behavior, verified against implementation/test evidence above.

## q072: static export canonical root URL index.html entry document redirect

**good** — answer availability: `indexed`.

Default top five contain a clear direct answer. Grades distinguish implementation-specific answers from adjacent context.

- `lat.md/view/architecture#Browser Architecture#Build targets#Static export` — rank 2; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Mounts documents at the configured base` — rank 8; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a portable server deployment` — rank 9; Directly documents the requested behavior, verified against implementation/test evidence above.

## q073: Node File Trace Vercel deployment asset tracing server bundle

**good** — answer availability: `indexed`.

Default top five contain a clear direct answer. Grades distinguish implementation-specific answers from adjacent context.

- `lat.md/view/architecture#Browser Architecture#Build targets#Vercel server export` — rank 1; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds Vercel output directly` — rank 3; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a portable server deployment` — rank 4; Directly documents the requested behavior, verified against implementation/test evidence above.

## q074: UI build output overwrite force generated marker tracked files code reference scanning git repository

**partial** — answer availability: `indexed`.

Top five answer scan scope but miss the overwrite/no-marker relationship, which Static export supplies at rank 6. Generated marker wording reflects historical design; current docs explicitly say no markers.

- `lat.md/view/architecture#Browser Architecture#Build targets#Static export` — rank 6; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/dev-process#Dev Process#File Walking` — rank 3; Directly documents the requested behavior, verified against implementation/test evidence above.

## q075: Vercel CDN immutable content hashed static assets cache control index revalidation deployment protection

**good** — answer availability: `indexed`.

Core cache policy is answered; deployment-protection configuration is not documented in the searched current code/docs, so that clause is a coverage gap rather than a proven ranking miss.

- `lat.md/view/specs#View Tests#Builds Vercel output directly` — rank 1; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a static deployment` — rank 3; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/architecture#Browser Architecture#Build targets#Static export` — rank 7; Directly documents the requested behavior, verified against implementation/test evidence above.

## q076: Vercel serverless function live Lat UI request response API ephemeral search cache no Git no watchers

**partial** — answer availability: `indexed`.

Both directly answering Server export and portable-server test spec are absent from top 10. Several results describe live Git/watchers that the query explicitly excludes. No inference about candidate-pool membership.

- `lat.md/view/architecture#Browser Architecture#Build targets#Server export` — outside top 10; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a portable server deployment` — outside top 10; Directly documents the requested behavior, verified against implementation/test evidence above.

## q077: deploy portable Express server build Cloudflare Workers Render hosting filesystem SQLite WASM

**good** — answer availability: `indexed`.

Judged portable hosting requirements, not a demand for a Workers recipe. Current artifact is Node/Express with filesystem access; no indexed platform-specific Workers or Render recipe was found.

- `lat.md/view/architecture#Browser Architecture#Build targets#Server export` — rank 3; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a portable server deployment` — rank 1; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Selects server deployment targets` — rank 7; Directly documents the requested behavior, verified against implementation/test evidence above.

## q078: lat ui build output directory already exists overwrite generated marker refuse destination

**good** — answer availability: `indexed`.

Correct current overwrite behavior is at ranks 3 and 4 despite two distracting leading results. Marker assumption is historical and explicitly corrected by the existing architecture.

- `lat.md/view/architecture#Browser Architecture#Build targets#Static export` — rank 3; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a static deployment` — rank 4; Directly documents the requested behavior, verified against implementation/test evidence above.

## q079: server build semantic search cold start preindexed embedding runtime performance

**good** — answer availability: `indexed`.

Architecture answers cost avoidance and lifecycle, but no measured deployed cold-start latency is claimed.

- `lat.md/view/architecture#Browser Architecture#Build targets#Server export` — rank 1; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a portable server deployment` — rank 2; Directly documents the requested behavior, verified against implementation/test evidence above.

## q080: static UI export size source views duplicated highlighted code JSON context references bundle output

**good** — answer availability: `indexed`.

Default top five contain a clear direct answer. Grades distinguish implementation-specific answers from adjacent context.

- `lat.md/view/architecture#Browser Architecture#Build targets#Static export` — rank 1; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/view/specs#View Tests#Builds a static deployment` — rank 6; Directly documents the requested behavior, verified against implementation/test evidence above.
- `lat.md/external-sources#External Sources#Browser Integration#Static Export` — rank 3; Directly documents the requested behavior, verified against implementation/test evidence above.

## q081: CLI check command options diagnostics timing profiling validation phases output tests

**good** — answer availability: `indexed`.

Excellent match across implementation docs and specific behavioral specs.

- `lat.md/tests/check-headless#Check Explicit Directories#Profiles validation work` — rank 1; Explains detailed profiling output
- `lat.md/cli#CLI#check` — rank 2; Complete check options and timing behavior
- `lat.md/architecture-analysis#Parsed Analysis#Validation` — rank 3; Explains validator phases

## q082: CLI machine-readable JSON output for search locate refs section graph commands and interactive terminal integrations

**no_indexed_answer** — answer availability: `absent`.

Missing capability rather than demonstrated ranking failure. Results navigate existing text-output architecture; no indexed section explicitly documents requested JSON mode.

- `lat.md/cli#CLI` — rank 2; Shared command API has structured internals but CLI prints text
- `lat.md/cli#CLI#Section Preview` — rank 3; Describes actual Markdown output, not JSON
- `lat.md/cli#CLI#mcp` — rank 5; MCP integration useful alternative, wraps text

## q083: Claude UserPromptSubmit Stop hooks integration and adding Codex lifecycle hooks

**good** — answer availability: `indexed`.

Historical query asks adding Codex; capability now exists and results expose it well.

- `lat.md/cli#CLI#init#Codex` — rank 3; Codex hook installation and setup
- `lat.md/cli#CLI#init#Claude Code` — rank 4; Claude hook installation
- `lat.md/cli#CLI#hook#Stop` — rank 8; Complete shared stop lifecycle
- `lat.md/cli#CLI#hook#UserPromptSubmit` — rank 9; Complete shared prompt lifecycle

## q084: Codex init setup MCP skills hooks Claude UserPromptSubmit Stop parity tests

**good** — answer availability: `indexed`.

Main setup ranks first; parity behavior is readily accessible.

- `lat.md/cli#CLI#init#Codex` — rank 1; Complete Codex setup contract
- `lat.md/cli#CLI#hook#UserPromptSubmit` — rank 2; Shared prompt payload with agent fields
- `lat.md/tests/hook#Hook#Codex prompt hook reads the Codex prompt field` — rank 3; Exact Codex prompt test
- `lat.md/cli#CLI#init#Claude Code` — rank 9; Claude setup allows parity comparison

## q085: No init version recorded warning lat_init.json cache committed checkout lat.md repository

**partial** — answer availability: `indexed`.

Answer survives at ranks 3-4, but two unrelated external-cache sections lead and 8/10 are irrelevant. Exact filename alone does not secure top rank.

- `lat.md/cli#CLI#check` — rank 3; Explains warning and local metadata path
- `lat.md/cli#CLI#init` — rank 4; Explains local version stamp creation

## q086: Stop hook safely count relevant untracked lat.md source files gitignore tests

**good** — answer availability: `indexed`.

Best test and operational section occupy ranks 1-2; exact test wording helps.

- `lat.md/tests/hook#Hook#Counts tracked and untracked files together` — rank 1; Exact integration fixture contract
- `lat.md/cli#CLI#hook#Stop` — rank 2; Details classification, gitignore and scope
- `lat.md/tests/hook#Hook#Counts untracked files before the first commit` — rank 3; Unborn repository edge case

## q087: generated AGENTS template valid section leading paragraphs lat init

**partial** — answer availability: `indexed`.

Default top5 has parent overview at 5 but specific generated-template regression at 7 is obscured by generic leading-paragraph checks.

- `lat.md/tests/init#Init#Generated instructions#Templates satisfy graph validation` — rank 7; Exact generated-template regression spec
- `lat.md/tests/init#Init#Generated instructions` — rank 5; Generated guidance validity requirement
- `lat.md/markdown#Markdown#Leading Paragraph` — rank 1; Relevant validity rule, lacks generated-template contract

## q088: init embedding backend prompt preserve hosted non-interactive config persistence README init version CLI styler

**good** — answer availability: `indexed`.

Strong retrieval for core compound intent. README/style tokens are secondary and not separately answered.

- `lat.md/cli#CLI#init` — rank 1; Full initialization behavior including backend preservation
- `lat.md/tests/init#Init#Embedding setup#Non-interactive re-run does not choose` — rank 2; Current noninteractive preservation contract
- `lat.md/tests/init#Init#Embedding setup#Current setup preserves explicit backend choice` — rank 4; Explicit backend choice retained

## q089: nested lat project inside larger git worktree project root stop hook diff scope

**good** — answer availability: `indexed`.

Exact operational answer first and regression spec third.

- `lat.md/cli#CLI#hook#Stop` — rank 1; Exact --relative -- . scoping implementation
- `lat.md/tests/hook#Hook#Counts tracked and untracked files together` — rank 3; Exact nested fixture excluding siblings

## q090: stop hook exits cleanly when project is not a git repository while still validating lat.md

**good** — answer availability: `indexed`.

Exact capability and implementation rank 1-2 with both channels agreeing at rank1.

- `lat.md/tests/hook#Hook#Supports projects outside Git` — rank 1; Exact non-Git contract
- `lat.md/cli#CLI#hook#Stop` — rank 2; Complete Git-optional stop implementation

## q091: CI operating system matrix Windows Linux pull request preview deployment

**partial** — answer availability: `indexed`.

CI is answered at rank 1, but the actual preview workflow is ranks 6 and 8. The second result has lexical rank 1 and semantic rank 10: preview terminology is conflated with terminal preview formatting. No claim about absent candidates; the missed answer is present in top 10.

- `lat.md/dev-process#Dev Process#Testing#Continuous Integration` — rank 1; Direct Windows/Ubuntu matrix and cross-platform validation details.
- `lat.md/dev-process#Dev Process#Site Development` — rank 8; Directly states Vercel Git integration owns preview deployment.
- `lat.md/view/specs#View Tests#Builds this repository's site directly` — rank 6; Describes branch vendoring and repository preview build workflow.

## q092: Dart 3.7 dot shorthand grammar code reference annotation dangling errors tests

**good** — answer availability: `indexed`.

Excellent compound-query coverage: both requested behaviors occupy the first two results and source tests confirm them.

- `lat.md/tests/check-code-refs#Check Code Refs#Scans Dart references around annotations` — rank 1; Directly specifies annotation and dangling-reference behavior.
- `lat.md/tests/check-md#Check MD#Passes with valid links#Accepts Dart dot shorthand` — rank 2; Exact dot-shorthand grammar regression.
- `lat.md/tests/check-md#Check MD#Passes with valid links#Passes with Dart source symbol links` — rank 4; Comprehensive Dart source-symbol validation spec.
- `lat.md/markdown#Markdown#Wiki Links#Source Code Links` — rank 3; Dart symbols, annotation ranges and code comments are documented.

## q093: Java source parser symbols code references tests source formats

**good** — answer availability: `indexed`.

Direct Java test and user-facing symbol contract are ranks 2 and 3; source registry and extractor agree.

- `lat.md/tests/check-md#Check MD#Passes with valid links#Passes with Java source symbol links` — rank 2; Direct exhaustive Java symbol validation specification.
- `lat.md/markdown#Markdown#Wiki Links#Source Code Links` — rank 3; Direct Java syntax, member resolution and parser behavior.
- `lat.md/architecture-analysis#Parsed Analysis#Source analysis` — rank 1; Explains source symbol analysis with Java support.
- `lat.md/tests/analysis-tests#Parser Analysis Tests#Caches every supported source language` — rank 5; Explicit registry fixture coverage for every language.

## q094: WASM engine loader generated glue model asset paths embedding package build

**good** — answer availability: `indexed`.

Several specific indexed answers in top 5; source confirms explicit module-relative read and injected initializer. Ranking the rejection test before positive behavior is harmless here.

- `lat.md/tests/search#Search#RAG Tests#Patches generated WASM loading explicitly` — rank 2; Exact explicit-initializer build contract.
- `lat.md/cli#CLI#search#Embeddings` — rank 4; Explains embedding package loader and model architecture.
- `lat.md/view/specs#View Tests#Builds Vercel output directly` — rank 3; Explains real runtime graph and analyzable WASM paths.
- `lat.md/tests/search#Search#RAG Tests#Rejects unknown generated WASM glue` — rank 1; Exact failure contract for unknown generated glue.

## q095: Windows backslash code refs path resolution check code-refs locate regression

**good** — answer availability: `indexed`.

Best possible first two results. Rank 3 documents opposite behavior for regular Markdown links, appropriately useful only when its different scope is respected.

- `lat.md/tests/ref-resolution#Ref Resolution#Windows-style backslash refs pass` — rank 1; Exact compatibility test for Windows-style code refs.
- `lat.md/parser#Parser#Short Ref Resolution` — rank 2; Direct normalization invariant, historical bug and resolution behavior.

## q096: development setup Rust native linker build tools prerequisite

**good** — answer availability: `indexed`.

Exact answer at rank 1, including native linker warning. No retrieval limitation; long tail includes one clear semantic mismatch.

- `lat.md/dev-process#Dev Process#Development Setup` — rank 1; Exact platform linker prerequisite and full setup commands.
- `lat.md/dev-process#Dev Process#Development Commands` — rank 3; Focused WASM/Rust build commands answer setup workflow.

## q097: npm publishing package dependencies install size versions

**good** — answer availability: `indexed`.

Retrieval is strong, but retrieved Publishing docs incorrectly say four packages and Publish Workflow omits stemmer. Actual workflow publishes five packages, including stemmer. No overall install byte total is documented; stemmer size alone is not the total.

- `lat.md/dev-process#Dev Process#Publishing#Publish Workflow` — rank 1; Direct publish order and version-existence checks.
- `lat.md/dev-process#Dev Process#Publishing` — rank 2; Direct package contents and workspace dependency pinning, but count stale.
- `lat.md/dev-process#Dev Process#Publishing#Release Process` — rank 3; Direct versioning/release policy.
- `lat.md/view/specs#View Tests#Keeps build-only packages out of runtime dependencies` — rank 5; Explains excluding build-only dependencies to reduce install footprint.
- `lat.md/search-design#Search Redesign#Evaluation and delivery#Application-side stemming` — rank 7; Specific stemmer download footprint, not overall install size.

## q098: publishing prerelease beta npm dist tags release workflow versioning

**partial** — answer availability: `indexed`.

General release answers are easy to find. No indexed beta/dist-tag policy found; workflow has no --tag or prerelease branch. This is a missing documented procedure, not evidence that a beta answer was ranked too low.

- `lat.md/dev-process#Dev Process#Publishing#Release Process` — rank 2; Answers release/versioning part substantially, not prereleases.
- `lat.md/dev-process#Dev Process#Publishing#Publish Workflow` — rank 1; Current publication mechanism is useful, but specifies no beta tag.

## q099: quick start install Lat

**partial** — answer availability: `indexed`.

init is semantic rank 1 but fused rank 2 behind mcp. Exact npm install answer exists in README.md:37-42 and headingless lat.md/lat.md:1, neither represented as a section in frozen sections.json. Thus missing install command is largely an indexing/document-structure coverage gap, not a known omitted ranked section.

- `lat.md/cli#CLI#init` — rank 2; Direct first setup step and wizard, missing global npm install command.

## q100: whether generated instruction templates should enumerate supported source languages or stay generic

**no_indexed_answer** — answer availability: `source_only`.

No explicit indexed policy or rationale for this decision found. Actual templates use generic supported-source language and examples, while src/source-formats.ts is canonical registry. Search returns reasonable navigation; it cannot supply an unrecorded rationale.

- `lat.md/cli#CLI#init#Generated instruction ownership` — rank 1; Instruction ownership helps locate template authority but does not decide language enumeration.
- `lat.md/cli#CLI#gen` — rank 7; Template generation command helps inspect actual output.
- `lat.md/markdown#Markdown#Wiki Links#Source Code Links` — rank 4; Enumerates supported languages in user docs; no template decision.
