---
lat:
  require-code-mention: true
---
# Ref Extraction

Tests for extracting wiki link references from parsed markdown files.

## Extracts wiki link references

Parse a file containing [[parser#Wiki Links]] and verify `extractRefs` returns correct targets, enclosing section ids, file stems, and line numbers.

## Returns empty for files without links

Verify `extractRefs` returns an empty array when a file has no wiki links.
