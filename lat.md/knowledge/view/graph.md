# Graph View

The graph view is a dedicated workspace for exploring relationships among Lat documents and referenced code without leaving the browser.

## Research basis

The first version adopts the useful interaction model of Obsidian's graph while keeping Lat's code relationships explicit and rolling section links up to their documents.

[Obsidian's graph](https://obsidian.md/help/plugins/graph) treats notes as nodes and internal links as edges, sizes nodes by incoming references, highlights neighbors on hover, opens nodes on click, and supports pan and zoom. Its filters, force controls, groups, and local-depth view are later-stage options for Lat.

[Sigma.js](https://www.sigmajs.org/docs/) renders the graph with WebGL, Graphology supplies the graph model, and typed [node events](https://www.sigmajs.org/docs/advanced/events/) cover hover and click selection. A custom D3 canvas would make Lat own rendering, labels, hit testing, and camera controls.

Lat uses `sigma` and `graphology` directly as development dependencies. The renderer ships with the main client and the graph payload is prefetched after startup, so switching modes does not wait for a chunk, request, or force simulation.

## Product shape

Graph mode replaces the document layout with a full-viewport graph workspace while preserving the selected document or source URL.

- The graph uses the full left half; its logo, active Graph toggle, semantic filter, and node count float over the canvas instead of reserving a panel header. Git and page Search controls stay hidden in this mode. The right half begins directly with the node preview and has no inspector title bar.
- The sidebar background covers the viewport, split equally between the graph and an independently scrollable inspector.
- Enabling Graph on a document or represented source selects that node immediately. A section URL selects its owning document; with no represented node, the inspector explains how to choose one.
- The browser URL always remains the exact document, section, source, or code-line target. Node and inspector navigation use ordinary history entries, so reload, copied URLs, Back, and Forward retain their normal meaning while Graph stays active.
- The graph icon only toggles a namespaced `localStorage` presentation setting; it does not rewrite history. Disabling Graph reveals the same selected target in the file/source layout immediately, and the persisted setting restores Graph after reload.
- Narrow screens stack a bounded graph above the inspector instead of forcing two narrow columns.

```text
┌ lat.md  Git  Search  Graph  Filter…         │ selected node    ┐
│                              │                                 │
│       interactive graph      │       selected node             │
│             50%              │       50%, scrollable           │
│                              │                                 │
└──────────────────────────────┴─────────────────────────────────┘
```

## Graph semantics

Stable canonical node ids let snapshots update without losing selection or settled positions.

### Nodes

Documents form the graph backbone, while code nodes appear when source definitions or `@lat:` mentions participate in a semantic relationship. Sections resolve links but never become graph nodes.

- `document:<lat-relative-path>` represents each Markdown file. File-only and section links resolve to this node.
- `source:<project-path>#<symbol>` represents a source definition targeted by a wiki link. A file-only source target omits the symbol.
- `code-ref:<project-path>:<line>` represents the cached code snippet containing an `@lat:` mention and links to its target document.

Each node includes `id`, `kind`, `label`, canonical `url`, breadcrumbs, reference counts, and optional Git state, error count, source signature, or snippet. Node radius grows logarithmically with incoming references, so backlinks—not outgoing links—determine prominence.

### Edges

Edges preserve direction and provenance while collapsing duplicate visual lines.

- Resolved wiki and ordinary Markdown links connect the containing document to the target section's owning document.
- Source wiki links connect their containing document to a source node.
- `@lat:` mentions connect a code-reference node to the target section's owning document.
- Collapse equal `from`, `to`, and `kind` triples into one edge with an occurrence weight. Keep `wiki`, `markdown`, `source`, and `code-mention` kinds so filters and styling remain possible.
- Omit unresolved and ambiguous targets, plus links whose endpoints collapse into the same document. Section resolution preserves authored meaning without adding section or containment nodes that make the graph dense or inflating backlinks with self-links.

## Server projection

The graph is another immutable projection of the existing view snapshot, not a new scanner or database.

[[src/view/graph.ts#buildViewGraph]] builds a `ViewGraph` beside [[src/view/references.ts#buildViewReferenceIndex]] from cached Markdown files, sections, outgoing links, diagnostics, Git state, and code references.

`GET /api/graph` returns the already-built projection and its snapshot generation without filesystem reads, parsing, source scanning, Git commands, or layout work.

Whenever [[src/view/store.ts#createViewStore]] replaces its snapshot, it rebuilds the graph from cached occurrences. Generation events make an open graph refetch; the client retains surviving positions and places new nodes deterministically without animation.

## Client and selection

The graph canvas and inspector share route state but keep rendering responsibilities separate.

The client prefetches the graph projection after startup and includes `GraphView` in its main bundle. A deterministic linear-time layout places documents on a ring and clusters code around its strongest document neighbor, so Sigma can paint immediately without physics or animation.

Sigma reducers dim unrelated nodes and edges on hover, emphasize immediate neighbors, render documents in Vercel blue and code in warm orange, and keep the selected node labeled. Every visible label uses white text and shadow on an 80%-opaque black plate; highly referenced nodes receive default labels.

With no semantic filter, node radius reflects incoming references. Search preserves each hit's cosine score, rolls a document's strongest section hit into its graph node, gives adjacent code that score, and normalizes visible radii across the current result set.

A node click navigates to its canonical document or source URL and renders the right pane with existing APIs and presentation: documents reuse the Markdown payload, while source and code-reference nodes reuse the source payload and focused line or symbol.

Plain internal links inside the inspector keep Graph active and navigate to their normal exact routes. Same-document fragments resolve against the preview and scroll without refetching the document; modified clicks retain normal browser behavior.

The graph pane remains fixed while the inspector scrolls from the top edge. The preview keeps current Git rendering, validation markers, backlinks, source context, and code expansion without wrapping them in another title toolbar.

## Initial scope

The initial workspace favors direct exploration over a large settings surface.

It includes pan, zoom, node drag, hover-neighbor highlighting, click selection, fit/reset, kind toggles for documents and code, embedding search, and directed edge arrows.

The text input follows the app buttons and debounces through the same indexed embedding search as `lat search`. Matching sections map to their document nodes and adjacent code nodes, filtering only the canvas with no result list or dropdown.

Defer Obsidian-style color groups, user-tunable forces, animation history, saved filters, and local-depth graph mode. Their protocol can build on stable node kinds and edge provenance after the global graph is useful.

## Verification

Tests protect canonical graph meaning, persisted mode state, route-to-node selection, deterministic finite positions, semantic-result projection, and the production bundle.

The mixed fixture asserts exact node kinds, section-to-document edge projection, weighted wiki and code-mention edges, backlink totals, static layout, semantic filtering, `/api/graph`, and the graph client shell.
