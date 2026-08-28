---
lat:
  require-code-mention: true
---

# View Tests

Functional specifications for the browser server, static export, client navigation, and `lat ui` startup.

## Serves the document index and browser shell

The loopback server exposes the visible Markdown index, redirects its root to the vault index, and serves the client shell for document routes.

By default the header renders the same Lat wordmark as the website. `lat ui --logo-text <text>` replaces it with safely rendered plain text.

## Builds a static deployment

`lat ui build [output]` emits a host-ready immutable snapshot with physical document and source routes, lazy graph data, and a compatibility entrypoint for old graph URLs.

The static client keeps Markdown and wiki navigation, backlinks, validation, source views, TOCs, and graph inspection. It does not expose Git or search, perform live API requests, or subscribe to project changes.

Every source file stores its raw text and highlighted lines once. Request-specific focus, context, and reference metadata stays in small separate payloads, so multiple links into one file do not duplicate its code.

`lat ui build --logo-text <text>` persists the same plain-text override in the static manifest; without it, the exported client uses the website wordmark.

An absolute `--base` path nests the payload under that path as well as prefixing its URLs, so the output directory itself remains the deployment root.

Any existing output path is rejected before snapshot work begins, including an empty directory or prior generated export. Callers must remove it explicitly or choose a new destination.

The generated marker excludes the entire artifact from both ripgrep and fallback code-reference scans, preventing exported JSON and bundles from polluting project checks or search.

## Builds the website wiki from published embedding packages

Website deployments compile the current Lat UI against pinned npm releases of the embedding engine and model package, avoiding Rust, WASM, and model generation in the Vercel build.

## Renders Markdown with navigable local links

Markdown becomes safe HTML with GitHub-style heading ids while ordinary relative links retain their destinations and fragments. HTTP(S) and protocol-relative links append a decorative external-site icon in documents and rendered reference contexts.

GitHub-flavored pipe tables render as semantic HTML tables. Wide tables stay within the document column and scroll horizontally instead of flattening into pipe-delimited text or widening the page.

Single- and double-tilde GitHub strikethrough syntax renders semantic deleted text rather than literal delimiters.

GitHub task-list markers render checked or unchecked disabled checkboxes with compact list alignment, preserving document readability without implying that the source file can be edited from the viewer.

Bare HTTP(S), `www.`, and email addresses render as links. Web addresses receive the same external-site treatment as explicit Markdown links, while trailing prose punctuation stays outside the destination.

GitHub-compatible raw HTML renders only through the sanitizer allowlist. Safe formatting and disclosure elements survive, while scripts, event handlers, and unsafe URL protocols never reach the client.

GitHub `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION` alert blockquotes render as labeled callouts with type-specific color, while non-alert blockquotes retain their ordinary presentation.

GitHub footnotes render linked superscript references and a compact end section with return links, rather than being misread as ordinary Markdown reference links.

Recognized GitHub emoji shortcodes render as accessible Unicode emoji or GitHub custom emoji assets; unknown shortcodes stay literal, and rendering never rewrites the authored Markdown.

## Shows a local table of contents

Markdown documents expose their H1 plus nested subsection headings in a sticky right rail on wide screens. The root entry stays bold without shifting subsection indentation; every entry links to its canonical fragment.

The fixed-width desktop rail fills the available viewport height without programmatic resizing. Its list stays content-height when short and scrolls without a visible scrollbar when long; fixed link metrics never compress, and short final sections activate in sequence.

Sections containing rendered Git changes carry an orange disc when Git is enabled, while sections owning validation errors carry a red disc. Both remain visible together when both states apply.

## Adapts navigation to mobile screens

Below 64rem, files remain reachable through a sticky two-row header and a scrollable full-viewport navigation overlay instead of a compressed or hidden desktop sidebar.

The overlay exposes its expanded state, uses touch-sized file targets, locks document scrolling while open, and closes on navigation, Escape, or a return to desktop width. Content gutters narrow, code scrolls horizontally, and the graph stacks above its inspector.

When the desktop TOC rail no longer fits, a compact `On this page` control shares an aligned metadata row and expands its links in a bounded overlay without moving content. On mobile it becomes a full-width row below the app header, retains active and Git/error states, closes after selection or Escape, and offsets fragment targets.

## Renders the graph workspace

Graph mode consumes a cached projection of documents, source targets, and code mentions with stable nodes and weighted directed edges. Section links collapse into their owning document rather than producing section nodes.

The client renders a 50/50 graph and inspector. The logo and Graph toggle retain their normal desktop positions while floating over the graph with the semantic filter; Git and page Search are hidden. The right panel begins with the node preview and has no toolbar.

The graph button persists a namespaced `localStorage` presentation setting without changing the current URL or browser history. Toggling it off immediately reveals the exact selected target in the normal file/source layout, and reload restores the stored mode.

Plain document, section, source, and code-reference links navigate through their normal URLs without leaving Graph, so Back and Forward work without mode-specific history. Relative fragments resolve against the previewed document without refetching its content.

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

Code links show a language badge bound to the label's first word so it cannot wrap alone, while unaliased links visually separate muted path context from the final target.

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

Blocks with less than 60% ordered word-token overlap render as whole removed and added blocks instead of noisy word-level replacements.

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

Selecting the H1 entry in the page TOC keeps its canonical fragment while positioning the document at scroll-top zero instead of aligning the rendered heading.

## Restores history scroll positions

In-app navigation records each viewport and restores it before revealing content reached through Back.

Search waits for asynchronous results before restoring its saved viewport.

## Rejects files outside the Markdown vault

The document API rejects traversal and non-Markdown targets so browser requests cannot read arbitrary project files.

## Launches the browser after the server starts

`lat ui` prefers loopback port 4242, advances when an implicit default is occupied, and starts listening before passing the final URL to the platform browser launcher.

An explicit `--port <number>` accepts 1–65535 and fails clearly rather than selecting another port when occupied. Startup reports the URL and points users to `lat ui build` for static export.
