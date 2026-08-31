---
lat:
  require-code-mention: true
---

# External Sources

External-source tests verify pinned remote content is resolved reproducibly and safely across every Lat interface.

## Configuration and targets

Strict configuration and target tests cover canonical and local schemas, URL normalization, actionable fetch-template diagnostics, paths, commits, prefixes, supported default extensions, aliases, and unknown handles.

## Retrieval strategies

Hermetic HTTPS tests exercise raw-file fetches, managed partial Git checkouts, and local overrides with multiple remote URLs and mismatch diagnostics without contacting public hosts.

Fetch tests reject repository-browser HTML so a misconfigured raw-file template reports the provider problem instead of misleading document-fragment errors.

Local override coverage accepts root and nested checkout paths regardless of Windows path spelling, then resolves content from the discovered worktree root.

## Document formats

Format tests verify Markdown, reStructuredText, and AsciiDoc expose complete titles, consistent heading aliases, explicit anchors, nested source ranges, safe document trees, retrieval, backlinks, graph nodes, and previews.

AsciiDoc coverage includes explicit document-title IDs and sections after legacy source blocks whose opening and closing delimiter lengths differ.

### Native document tree projection

reStructuredText and AsciiDoc parse nodes project directly into safe canonical trees. External links share document icons, labeled supported source blocks highlight, unlabeled literals stay plain, and raw pass-through markup remains inert.

## Persistent document analysis cache

External Markdown, reStructuredText, and AsciiDoc analyses use validated versioned cache entries, invalidate changed content, recover from malformed payloads, and share one provider load and parse across every fragment of a file.

## Cache reconciliation

Cache tests verify schema-version, exact provider-source, commit, and strategy generations, atomic publication, concurrency, removal, local transitions, and failure without stale fallback.

Missing or mismatched schema-version metadata forces complete regeneration of that source's cached files before resolution continues.

## Commands and MCP

Functional tests cover add, show, list, section, expand, refs, check, initialization, and the read-only external MCP tools.

### Content commands and MCP

Management, resolution, validation, and MCP operations expose the same pinned external-source behavior through their respective interfaces.

### Interactive add prompt lifecycle

Interactive add hands terminal input safely between line prompts and raw selection so the final confirmation remains live and the source is added only after consent.

## Browser and static export

View tests verify external previews share the versioned document tree with local files while preserving backlinks, graph nodes, diagnostics, live local refreshes, and canonical offline static bundles without Git object storage.

### Live external previews

The live server renders each supported external document kind and exposes its backlinks and graph relationships without relying on browser-side repository access.

External source-code previews persist their AST-free symbol tables under a handle-scoped parser-cache identity.

### Local watcher refresh

A watched local checkout rebuilds the view generation after a referenced file changes, and the next external document request returns the dirty working-tree content.

### Unused source omission

Configured external sources with no references remain absent from the browser index so navigation reflects only content the project actually uses.

### Canonical static export

Static export ignores machine-local overrides, bundles the canonical commit once per external file, writes navigable routes, and never publishes managed Git storage.

### Validation diagnostics

Broken external fragments appear in the browser index and rendered document as actionable validation errors instead of failing the view server.

### Sidebar discovery

The sidebar places used source-handle folders beneath an `External sources` label, lists each referenced file once, omits configured-but-unused sources, and gives live and static clients a navigable full-file route.
