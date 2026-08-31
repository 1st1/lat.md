# Parsed Analysis

Lat turns local Markdown, external documents, and referenced source files into serializable semantic facts so commands can share parser results without retaining syntax trees.

## File analysis

A file analysis is the complete serializable result of reading and parsing one Markdown file once.

It retains the source content and records paths, frontmatter, ordered sections and source ranges, heading slugs, paragraphs, outgoing wiki references, ordinary Markdown links, directory-index entries, and locally decidable diagnostics.

The syntax tree is private working state. It is created, visited, and discarded inside the analyzer; it is never returned, cached in a project snapshot, or transferred between workers.

HTML and Git-diff rendering may parse Markdown through dedicated presentation APIs, but presentation syntax trees do not provide semantic project facts.

## External document analysis

An external document analysis is the format-neutral section index extracted from one pinned Markdown, reStructuredText, or AsciiDoc file.

It records the document title plus ordered section titles, hierarchy, anchors, aliases, and source ranges. Native parser trees are discarded, and the result remains separate from the local project graph and semantic search index.

Each resolver loads provider content and analyzes a complete external file once per request. Every fragment in that file selects its range from the shared analysis instead of retrieving or parsing the document again.

## Source analysis

A source analysis is the serializable symbol table extracted from one supported JavaScript, TypeScript, Python, Rust, Go, or C file.

It records symbol names, kinds, parents, source ranges, and signatures. Tree-sitter syntax trees and grammar instances remain private parser state and are never serialized.

[[src/source-formats.ts#SOURCE_FILE_EXTENSIONS]] is the authoritative source-format registry. Its derived union requires every registered extension to have a grammar, symbol extractor, and parser test fixture, and it also scopes code-mention discovery and external source-file validation.

Source analysis stays lazy: only a file named by a source-code wiki link is read. Concurrent references to the same file share one promise-backed runtime result.

## Persistent cache

Successful local Markdown, external document, and source analyses persist below `lat.md/.cache/parsed/` so later commands can reuse unchanged semantic facts without loading their parsers.

Each local cache identity is the normalized project-relative full path. External documents and source code use `@external/<handle>/<path>` so different providers cannot collide. The first two lowercased characters of the short name supply a predictable shard directory, while a full-identity SHA-1 digest prevents collisions and a bounded readable suffix makes entries inspectable. Non-ASCII or punctuation shard characters become `_`.

```text
lat.md/.cache/parsed/se/abcdef0123456789abcdef0123456789abcdef01_lat_md_guide_setup_md
```

The first line is `v<N>:<sha1>`, where `N` is [[src/parser-cache.ts#PARSER_CACHE_VERSION]] and the hash covers the complete input content. The remaining bytes are the compact JSON serialization of a local Markdown analysis, external document index, or source symbol table.

A hit requires both the current parser-cache version and content hash, plus matching path identity and a structurally valid payload for that parser. Changed content, parser semantics, truncated writes, malformed JSON, or unexpected shapes become ordinary misses.

Local Markdown cache lookup happens before executor selection, so only misses reach inline analysis or the worker pool. External document lookup happens after pinned content retrieval and before the format parser. Source lookup happens after a referenced file is read and before tree-sitter initialization, so a hit never loads the runtime or grammar WASM. Newly parsed entries use atomic replacement; cache read or write failures never prevent analysis because the directory is disposable and may be read-only.

Cached local Markdown analyses retain source content; external document and source entries retain only their semantic facts. None reuse old performance measurements: a hit records current read, hash, and cache-load timings with zero parse work. Orphaned entries from deleted or renamed files are harmless and may remain until `.cache` is removed.

## Project snapshot

A project snapshot reduces file analyses into immutable lookup structures shared by every operation in one command or request.

The parser-free [[src/lattice-model.ts]] module owns serializable graph types plus section flattening, indexing, lookup, and reference resolution. The snapshot uses those helpers to own files by normalized path, ordered sections, canonical section ids, file-suffix and heading-slug indexes, and outgoing and incoming reference indexes.

Consumers use snapshot indexes without importing Markdown syntax machinery. [[src/lattice.ts]] retains parsing and extraction functions and re-exports the graph API for compatibility, but internal graph consumers import the lightweight model directly.

Source code scanning and external-source reconciliation are separate project inputs because they are not facts that a Markdown worker can derive from one file.

## Validation

Validation has a local map phase and a project-wide reduce phase so each rule runs at the narrowest level with all required facts available.

File analysis records locally decidable structured diagnostics shared by CLI and browser validation. Project-wide validation resolves cross-file wiki and ordinary links, directory indexes, code mentions, source symbols, and external targets after all facts and inputs are assembled.

Diagnostics retain their rule, location, target, and presentation metadata so command output and browser markers can project the same local findings for their respective interfaces.

## Execution

Analysis semantics are independent of scheduling so the same analyzer supports direct calls, parallel commands, incremental browser updates, and tests.

The inline executor is the deterministic fallback for small jobs and focused tests. The worker executor uses a bounded dynamic queue, initializes one parser per worker, and returns only serializable file analyses.

Cache preparation and graph reduction do not import the Markdown analyzer. Inline Markdown analysis dynamically loads it only after at least one local cache miss; external Markdown and native format parsers are likewise loaded only after the complete external-document cache misses. A fully warm command therefore avoids unified/remark, reStructuredText, and AsciiDoc parser initialization.

Profiled checks record each parser-module import and its duration, including one event per Markdown worker. Cache hits emit explicit zero-duration skip events, making the absence of parser imports visible rather than inferred from missing parse work.

CLI project operations, including `lat check` and indexing, use workers above the small-project threshold. Browser startup builds the same file analyses into its incremental store; a refresh analyzes one changed file inline and replaces its contribution before rebuilding indexes.

## Command sessions

Each CLI or MCP request owns one lazy analysis session so nested operations share a consistent project snapshot without retaining stale data between commands.

This is especially important for `section` plus backlink lookup, `refs`, search result hydration, prompt expansion, and lifecycle hooks that invoke several semantic operations in one process.

The browser keeps its existing server-lifetime incremental store, but every stored Markdown entry uses the same file-analysis model and local diagnostics as command sessions.
