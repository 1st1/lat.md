---
lat:
  require-code-mention: true
---
# Locate

Tests for `findSections` covering exact, subsection, and fuzzy matching strategies.

## Finds sections by exact id

Given a full section path query (case-insensitive), `findSections` returns the matching section with correct metadata.

## Matches subsection by trailing segment

Given a query matching only a trailing segment (e.g. `Running Tests`), `findSections` returns sections whose id ends with that segment.

## Fuzzy matches with typos

Given a query with a typo (e.g. `Runing Tests`), `findSections` returns the closest match via edit distance.

## Strips brackets from query

A query wrapped in `[[brackets]]` is unwrapped before searching, so `[[locate]]` behaves the same as `locate`.

## Reports match reasons

Each result from `findSections` includes a `reason` string describing how it matched: `exact match`, `file stem match`, `section name match`, or `fuzzy match, distance N`.

## Strips leading hash from query

A query like `#Frontmatter` is treated as a bare heading search for `Frontmatter`, not as a full path with an empty file part.

## Matches with skipped intermediate sections

A query like `dev-process#Running Tests` matches `dev-process#Testing#Running Tests` by treating the `#`-separated segments as a subsequence. The reason reports how many intermediate sections were skipped.

## File stem fuzzy does not over-match

For full-path queries like `cli#locat`, fuzzy matching compares only the heading portion when the file part matches exactly. This prevents the shared file prefix from inflating similarity (e.g. `cli#locat` should not match `cli#prompt`).
