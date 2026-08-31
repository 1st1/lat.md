# Markdown Analysis

Every semantic Markdown consumer shares one AST-free analysis model so commands cannot diverge in how they discover sections, references, links, frontmatter, or diagnostics.

## File analysis

A file analysis is the complete serializable result of reading and parsing one Markdown file once.

It retains the source content and records paths, frontmatter, ordered sections and source ranges, heading slugs, paragraphs, outgoing wiki references, ordinary Markdown links, directory-index entries, and locally decidable diagnostics.

The syntax tree is private working state. It is created, visited, and discarded inside the analyzer; it is never returned, cached in a project snapshot, or transferred between workers.

HTML and Git-diff rendering may parse Markdown through dedicated presentation APIs, but presentation syntax trees do not provide semantic project facts.

## Persistent cache

Successful file analyses persist below `lat.md/.cache/parsed/` so later commands can reuse unchanged semantic facts without loading a parser or starting workers.

Each cache identity is the normalized project-relative full path. The first two lowercased characters of the file's short name supply a predictable shard directory, while a full-path SHA-1 digest prevents collisions and a bounded readable suffix makes entries inspectable. Non-ASCII or punctuation shard characters become `_`.

```text
lat.md/.cache/parsed/se/abcdef0123456789abcdef0123456789abcdef01_lat_md_guide_setup_md
```

The first line is `v<N>:<sha1>`, where `N` is [[src/markdown-analysis-cache.ts#PARSER_CACHE_VERSION]] and the hash covers the complete Markdown content. The remaining bytes are the compact JSON serialization of the file analysis.

A hit requires both the current parser-cache version and content hash, plus matching path identity and a structurally valid analysis payload. Changed content, parser semantics, truncated writes, malformed JSON, or unexpected shapes become ordinary misses.

Cache lookup happens before executor selection. The main process reads and hashes every file, returns hits immediately, and sends only misses to inline analysis or the worker pool. Newly parsed entries use atomic replacement; cache read or write failures never prevent analysis because the directory is disposable and may be read-only.

Cached analyses retain source content but not their old performance measurements. A hit records current read, hash, and cache-load timings with zero parse work. Orphaned entries from deleted or renamed files are harmless and may remain until `.cache` is removed.

## Project snapshot

A project snapshot reduces file analyses into immutable lookup structures shared by every operation in one command or request.

The snapshot owns files by normalized path, ordered sections, canonical section ids, file-suffix and heading-slug indexes, and outgoing and incoming reference indexes. Consumers use these indexes instead of rereading or reparsing files.

Source code scanning and external-source reconciliation are separate project inputs because they are not facts that a Markdown worker can derive from one file.

## Validation

Validation has a local map phase and a project-wide reduce phase so each rule runs at the narrowest level with all required facts available.

File analysis records locally decidable structured diagnostics shared by CLI and browser validation. Project-wide validation resolves cross-file wiki and ordinary links, directory indexes, code mentions, source symbols, and external targets after all facts and inputs are assembled.

Diagnostics retain their rule, location, target, and presentation metadata so command output and browser markers can project the same local findings for their respective interfaces.

## Execution

Analysis semantics are independent of scheduling so the same analyzer supports direct calls, parallel commands, incremental browser updates, and tests.

The inline executor is the deterministic fallback for small jobs and focused tests. The worker executor uses a bounded dynamic queue, initializes one parser per worker, and returns only serializable file analyses.

CLI project operations, including `lat check` and indexing, use workers above the small-project threshold. Browser startup builds the same file analyses into its incremental store; a refresh analyzes one changed file inline and replaces its contribution before rebuilding indexes.

## Command sessions

Each CLI or MCP request owns one lazy analysis session so nested operations share a consistent project snapshot without retaining stale data between commands.

This is especially important for `section` plus backlink lookup, `refs`, search result hydration, prompt expansion, and lifecycle hooks that invoke several semantic operations in one process.

The browser keeps its existing server-lifetime incremental store, but every stored Markdown entry uses the same file-analysis model and local diagnostics as command sessions.
