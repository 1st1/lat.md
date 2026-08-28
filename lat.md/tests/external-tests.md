---
lat:
  require-code-mention: true
---
# External Sources

External-source tests verify pinned remote content is resolved reproducibly and safely across every Lat interface.

## Configuration and targets

Strict configuration and target tests cover canonical and local schemas, URL normalization, inferred fetch templates, portable paths, immutable commits, prefixes, aliases, and unknown handles.

## Retrieval strategies

Hermetic HTTPS tests exercise raw-file fetches, managed partial Git checkouts, and local working-tree overrides without contacting public hosts.

## Cache reconciliation

Cache tests verify repository, commit, and strategy generations, atomic publication, concurrent reads, removed sources, local transitions, and failure without stale fallback.

## Commands and MCP

Functional tests cover add, show, list, section, expand, refs, check, initialization, and the read-only external MCP tools.

## Browser and static export

View tests verify external previews, backlinks, graph nodes, diagnostics, live local refreshes, and canonical offline static bundles without Git object storage.
