# Graph View

The graph view is a dedicated workspace for exploring relationships among Lat documents and referenced code without leaving the browser.

## Research basis

The first version adopts the useful interaction model of Obsidian's graph while keeping Lat's code relationships explicit and rolling section links up to their documents.

[Obsidian's graph](https://obsidian.md/help/plugins/graph) treats notes as nodes and internal links as edges, sizes nodes by incoming references, highlights neighbors on hover, opens nodes on click, and supports pan and zoom. Its filters, force controls, groups, and local-depth view are later-stage options for Lat.

[Sigma.js](https://www.sigmajs.org/docs/) renders the graph with WebGL, Graphology supplies the graph model, and typed [node events](https://www.sigmajs.org/docs/advanced/events/) cover hover and click selection. A custom D3 canvas would make Lat own rendering, labels, hit testing, and camera controls.

Lat bundles `sigma` and `graphology` from development dependencies and loads the renderer and graph payload on demand, keeping ordinary document startup independent of graph rendering.

## Product shape

Graph mode replaces the document layout with a full-viewport graph workspace while preserving the selected document or source URL.

- The graph uses the full left half; its logo, active Graph toggle, semantic filter, and node count float over the canvas instead of reserving a panel header. Git and page Search controls stay hidden in this mode. The right half begins directly with the node preview and has no inspector title bar.
- The graph draws across the desktop viewport behind the independently scrollable right-half inspector. Its translucent background softly blurs and desaturates the graph underneath without changing the sharpness or color of the content itself.
- Enabling Graph on a document or represented source selects that node immediately. A section URL selects its owning document; with no represented node, the inspector explains how to choose one.
- The browser URL always remains the exact document, section, source, or code-line target. Node and inspector navigation use ordinary history entries, so reload, copied URLs, Back, and Forward retain their normal meaning while Graph stays active.
- The graph icon only toggles a namespaced `localStorage` presentation setting; it does not rewrite history. Disabling Graph reveals the same selected target in the file/source layout immediately, and the persisted setting restores Graph after reload.
- Narrow screens stack a bounded graph above the inspector instead of forcing two narrow columns.
- Switching modes preserves the logo and toolbar's vertical position at every breakpoint.

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

Each node includes `id`, `kind`, `label`, canonical `url`, breadcrumbs, reference counts, and optional Git state, error count, source signature, or snippet. Circle area grows linearly with incoming references above a minimum visible area, so backlinks—not outgoing links—determine prominence. Selection never inflates that quantitative size.

A local document's incoming count sums the displayed direct backlink counts for its root and every nested section. Repeated links from one paragraph to the same section count once; links to different sections count separately. Same-document references and code mentions contribute too. Other nodes use incoming edge occurrence weights.

### Edges

Edges preserve direction and provenance while collapsing duplicate visual lines.

- Resolved wiki and ordinary Markdown links connect the containing document to the target section's owning document.
- Source wiki links connect their containing document to a source node.
- `@lat:` mentions connect a code-reference node to the target section's owning document.
- Collapse equal `from`, `to`, and `kind` triples into one edge with an occurrence weight. Keep `wiki`, `markdown`, `source`, and `code-mention` kinds so filters and styling remain possible.
- Omit unresolved and ambiguous targets, plus visible edges whose endpoints collapse into the same document. Same-document references still contribute to the page's section backlink total without drawing self-loops.

## Server projection

The graph is another immutable projection of the existing view snapshot, not a new scanner or database.

[[src/view/graph.ts#buildViewGraph]] builds a `ViewGraph` beside [[src/view/references.ts#buildViewReferenceIndex]] from cached Markdown files, sections, outgoing links, diagnostics, Git state, and code references.

`GET /api/graph` returns the already-built projection and its snapshot generation without filesystem reads, parsing, source scanning, Git commands, or layout work.

Whenever [[src/view/store.ts#createViewStore]] replaces its snapshot, it rebuilds the graph from cached occurrences. Generation events make an open graph refetch; the client retains surviving positions and places new nodes deterministically without animation.

## Client and selection

The graph canvas and inspector share route state but keep rendering responsibilities separate.

The client caches the on-demand graph projection. A deterministic linear-time layout places documents on a ring and clusters code around its strongest document neighbor, without physics or animation.

The graph uses restrained layers: neutral nodes and fine connections provide context, while selection and hover reveal document-blue and code-orange neighbors and directional arrows. Background edges stay visible during pan and zoom. Labels use theme-aware text with a narrow background halo rather than opaque cards; collision handling keeps ordinary labels from overlapping.

Selected and hovered labels include exact incoming reference counts. A canvas note explains whether size represents reference area or semantic relevance. This follows [Tufte's layering and smallest effective difference principles](https://www.edwardtufte.com/notebook/analytical-design-and-human-factors/) without removing the underlying relationships.

Outlined, translucent nodes remain distinguishable when overlapping. The circle shader premultiplies alpha for Sigma's blending mode but keeps picking IDs opaque. Edges and muted nodes use renderer-safe hex colors rather than CSS border tokens.

The selected node keeps a stronger fill, visible label, and foreground position even while another node is hovered. Unrelated connections stay visible rather than disappearing during selection.

Without a search filter, node radius reflects incoming references. [[view/src/GraphView.tsx]] uses each hit's hybrid `rankScore` from the [[rag-architecture#Result contract]], rolls a document's strongest section hit into its graph node, gives adjacent code that score, and normalizes visible radii across the current result set. Cosine similarity is a separate optional diagnostic; it does not control graph sizing.

A node click navigates to its canonical document or source URL and renders the right pane with existing APIs and presentation: documents reuse the Markdown payload, while source and code-reference nodes reuse the source payload and focused line or symbol.

Plain internal links inside the inspector keep Graph active and navigate to their normal exact routes. Same-document fragments resolve against the preview and scroll without refetching the document; modified clicks retain normal browser behavior.

The graph pane remains fixed while the inspector scrolls from the top edge. The preview keeps current Git rendering, validation markers, backlinks, source context, and code expansion without wrapping them in another title toolbar.

The left half remains the interaction and Fit area even though the canvas extends behind the inspector. Camera framing preserves its left-side center and relative zoom across resizing and mode changes. The inspector intercepts pointer input; narrow screens retain separate, opaque stacked panes.

## Initial scope

The initial workspace favors direct exploration over a large settings surface.

It includes pan, zoom, hover-neighbor highlighting, click selection, fit/reset, kind toggles for documents and code, embedding search, and directed edge arrows. Individual nodes cannot be dragged; their layout stays stable while dragging pans the graph.

The text input follows the app buttons and debounces through the same indexed embedding search as `lat search`. Matching sections map to their document nodes and adjacent code nodes, filtering only the canvas with no result list or dropdown.

Defer Obsidian-style color groups, user-tunable forces, animation history, saved filters, and local-depth graph mode. Their protocol can build on stable node kinds and edge provenance after the global graph is useful.

## Verification

Tests protect canonical graph meaning, persisted mode state, route-to-node selection, deterministic finite positions, semantic-result projection, and the production bundle.

The mixed fixture asserts exact node kinds, section-to-document edge projection, weighted wiki and code-mention edges, backlink totals, static layout, semantic filtering, `/api/graph`, and the graph client shell.
