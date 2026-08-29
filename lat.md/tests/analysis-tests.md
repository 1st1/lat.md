---
lat:
  require-code-mention: true
---
# Markdown Analysis Tests

These tests keep the shared Markdown analysis boundary deterministic, AST-free, and independent of its execution strategy.

## Returns serializable file facts

One parse produces sections, references, links, frontmatter, presentation facts, and local diagnostics without exposing the syntax tree.

## Produces equivalent inline and worker snapshots

Inline and worker executors produce identical semantic files and project indexes while worker count and timing remain implementation details.

## Reuses one command session snapshot

A command session returns the same lazily created project snapshot to nested semantic operations instead of reading and parsing the vault again.
