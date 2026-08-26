---
lat:
  require-code-mention: true
---

# View Tests

Functional specifications for the browser server, static export, client navigation, and `lat ui` startup.

## Serves the document index and browser shell

The loopback server exposes the visible Markdown index, redirects its root to the vault index, and serves the client shell for document routes.

`lat ui --logo-text <text>` replaces the top-left `lat.md` label with safely rendered plain text; omitting the option preserves the default.

## Builds a static deployment

`lat ui build [output]` emits a host-ready immutable snapshot with physical document, source, and graph routes plus lazy JSON data.

The static client keeps Markdown and wiki navigation, backlinks, validation, source views, TOCs, and graph inspection. It does not expose Git or search, perform live API requests, or subscribe to project changes.

Every source file stores its raw text and highlighted lines once. Request-specific focus, context, and reference metadata stays in small separate payloads, so multiple links into one file do not duplicate its code.

`lat ui build --logo-text <text>` persists the same label override in the static manifest.

An absolute `--base` path nests the payload under that path as well as prefixing its URLs, so the output directory itself remains the deployment root.

Any existing output path is rejected before snapshot work begins, including an empty directory or prior generated export. Callers must remove it explicitly or choose a new destination.

The generated marker excludes the entire artifact from both ripgrep and fallback code-reference scans, preventing exported JSON and bundles from polluting project checks or search.

## Renders Markdown with navigable local links

Markdown becomes safe HTML with GitHub-style heading ids while ordinary relative links retain their destinations and fragments.

## Shows a local table of contents

Markdown documents expose their H1 plus nested subsection headings in a sticky right rail on wide screens. The root entry stays bold without shifting subsection indentation; every entry links to its canonical fragment.

The fixed-width desktop rail fills the available viewport height without programmatic resizing. Its list stays content-height when short and scrolls without a visible scrollbar when long; fixed link metrics never compress, and short final sections activate in sequence.

## Renders the graph workspace

The graph route serves a cached projection of documents, source targets, and code mentions with stable nodes and weighted directed edges. Section links collapse into their owning document rather than producing section nodes.

The client renders a 50/50 graph and inspector. The logo, active Graph toggle, and semantic filter float over the full-height graph while Git and page Search buttons are hidden. The right panel begins with the selected node preview and has no inspector toolbar.

The graph button replaces the current route instead of navigating through browser history. Toggling it off opens the selected node's normal URL, activating the selected Markdown file in the tree for document nodes.

Document and code radii grow only with incoming references. Every rendered label stays white over an 80%-opaque black plate with a text shadow in normal, selected, and hover states.

The graph payload is prefetched after UI startup and a linear-time deterministic layout requires no force simulation, so toggling Graph paints immediately without a partial-page loading state, settling animation, or blocking pause.

Graph search debounces through the embedding-backed `/api/search` service used by `lat search`. Matching sections filter to their owning documents and adjacent code nodes without rendering a result popup. Their radii normalize by hit score; clearing search restores backlink sizing.

## Searches sections with embeddings

Search debounces embedding queries and renders ranked section summaries linked to their document anchors. Each result carries its finite cosine score so graph consumers can scale relevance without recomputing embeddings.

The URL preserves the latest query; Back restores it, and Escape clears the query before returning to the page that opened search. Clicking the active Search icon closes the search immediately without clearing first.

## Exposes code-mention frontmatter as metadata

Documents expose [[markdown#Frontmatter#require-code-mention]] separately from rendered HTML so the browser can badge files that require code references.

## Resolves Markdown and source wiki links

Resolved Markdown sections and validated source definitions become client-side links, while unresolved wiki targets remain authored text.

Unaliased code links show a language badge and visually separate muted path context from the final target.

Every resolved wiki link shows the total number of distinct reference locations for its canonical target. The current paragraph counts once, duplicate links in one paragraph do not inflate the total, and section totals include `@lat:` code references.

Source-symbol totals cover the exact symbol, while file-only source totals include references to any symbol in that file. Totals below two, unresolved links, and ambiguous links show no count.

## Serves source definitions securely

Source routes return supported project files and optional symbol ranges while rejecting traversal, unsupported extensions, missing symbols, and files outside the project root.

## Shows source reference context

Source links preserve their originating section and line so the code view can render the linking paragraph, emphasize the selected link, and expose other referencing sections.

## Shows section back-references

Referenced sections expose distinct linking Markdown paragraphs, wiki references, and `@lat:` code locations with navigable context.

## Updates long-running views incrementally

Changing, adding, or deleting project files updates cached documents, navigation, source references, and backlinks without rereading unchanged Markdown files.

Browser clients receive a change event and refresh the current route while keeping its URL and viewport stable.

## Refreshes search after Markdown changes

The first search indexes lazily, while a later Markdown generation triggers exactly one shared incremental indexing pass before new queries run.

## Shows live validation errors

Invalid Markdown files show a sidebar marker propagated through every ancestor directory, plus a top metadata error label whose entries jump to red-marked authored content.

The initial snapshot and every refresh recompute diagnostics from cached syntax trees, removing markers immediately when errors are fixed.

## Shows live Git state

Git worktrees show cached HEAD changes as yellow modified or green new-file markers, split with red for validation errors, while rendered Markdown highlights removed and added words inline.

Every rendered block in a new Markdown file inherits the added state, including headings, unordered and ordered lists with their markers, and fenced code blocks.

Blocks with less than 20% ordered word-token overlap render as whole removed and added blocks instead of noisy word-level replacements.

Startup reads Git once, and a later vault change refreshes that state. Polling also detects commits without filesystem events, clearing stale diff markers while unchanged Git snapshots remain silent.

The top Git toggle hides or reveals both sidebar markers and inline diffs without changing the underlying files.

The Git button retains an orange notification dot whenever changes exist, independent of the toggle state.

## Places context within a collapsed source window

Focused source views place reference context before the highlighted definition, keep five surrounding lines, and reveal collapsed code without moving the visible anchor.

## Highlights source syntax safely

Supported languages receive server-side token coloring while HTML-like source remains escaped and multiline tokens retain their styling.

## Builds a nested file tree

Vault paths form a natural-order hierarchy with root and directory index files pinned first and complete paths retained for navigation.

Selecting a directory opens its `name/name.md` index and keeps the directory expanded.

## Stabilizes fragment navigation immediately

Fragment links position rendered documents without smooth scrolling so content is immediately interactive.

Changing only a Markdown fragment preserves the mounted document and cached response through direct clicks and Back or Forward navigation, avoiding a loading state or full-content repaint.

## Restores history scroll positions

In-app navigation records each viewport and restores it before revealing content reached through Back.

Search waits for asynchronous results before restoring its saved viewport.

## Rejects files outside the Markdown vault

The document API rejects traversal and non-Markdown targets so browser requests cannot read arbitrary project files.

## Launches the browser after the server starts

`lat ui` starts listening before passing the loopback URL to the platform browser launcher and reports the same URL to the terminal.
