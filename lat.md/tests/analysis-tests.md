---
lat:
  require-code-mention: true
---

# Parser Analysis Tests

These tests keep Markdown and source analysis deterministic, AST-free, serializable, and safely reusable across parser executions.

## Returns serializable file facts

One parse produces sections, references, links, frontmatter, presentation facts, and local diagnostics without exposing the syntax tree.

## Produces equivalent inline and worker snapshots

Inline and worker executors produce identical semantic files and project indexes while worker count and timing remain implementation details.

## Reuses one command session snapshot

A command session returns the same lazily created project snapshot to nested semantic operations instead of reading and parsing the vault again.

## Persists and reuses unchanged file analysis

An unchanged Markdown file reloads the complete serializable analysis from its content-addressed persistent cache without constructing a parser AST or worker pool.

## Invalidates changed content and cache schemas

Changed Markdown bytes or an unsupported analysis-cache schema force a fresh parse and atomically replace the stale entry with current facts.

## Recovers from malformed cache entries

Malformed or partial cache data is treated as a disposable miss and replaced without making semantic commands fail.

## Uses collision-safe sharded cache paths

The first two lowercased short-name characters select a readable shard, while a normalized full-path digest keeps same-name and normalized-suffix entries collision-safe.

## Caches every supported source language

Unchanged JavaScript, TypeScript, Python, Rust, Go, C, and header files reload complete symbol tables without constructing tree-sitter syntax trees or loading grammar WASM.

## Invalidates source content and cache schemas

Changed source bytes or an unsupported shared parser-cache version force a fresh symbol extraction and atomically replace the stale entry.

## Recovers from malformed source cache entries

Malformed or partial source-symbol payloads become disposable misses and are replaced without making source-link validation fail.
