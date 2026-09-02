---
lat:
  require-code-mention: true
---

# View Tests

Functional specifications for the local browser, deployable builds, client navigation, and `lat ui` startup.

## Serves the document index and browser shell

The loopback server exposes the visible Markdown index, redirects its root to the extensionless vault-index route, and serves the client shell for extensionless document routes.

Requesting the same route with `.md` returns the exact known vault file as `text/markdown`; missing or escaping paths remain unavailable. `HEAD` returns the same source headers without a body.

Relative images and other non-Markdown files resolve through vault-contained resource routes. Missing files, directories, and paths that escape through traversal or symlinks remain unavailable.

By default the header renders the bundled Lat wordmark. `lat ui --logo-text <text>` replaces it with safely rendered plain text.

The browser shell keeps a default-self Content Security Policy while allowing the OpenFreeMap tile endpoint, GitHub's custom emoji image host, and data-backed renderer fonts.

The server anchors Vite's relative entry assets at `/assets/`, so every live document, source, search, and graph route loads the same production shell.

## Builds a static deployment

`lat ui build static [output]` emits a host-ready immutable snapshot with physical extensionless document and source routes, lazy graph data, and a compatibility entrypoint for old graph URLs.

Without an explicit output, it writes `.lat-build/static/`.

Every local document also emits its exact source at the corresponding `.md` URL, while generated, relative, search, backlink, and graph navigation all target the extensionless React route.

The build copies each vault-local resource reached from a rendered document once, preserves its vault-relative path, and rewrites its URL under the configured deployment base.

The static client keeps Markdown and wiki navigation, backlinks, validation, source views, TOCs, and graph inspection. It does not expose Git, search, or the runtime-only section command, perform live API requests, or subscribe to project changes.

Generated shells encode their base path, optional search endpoint, manifest, and initial route response as inert metadata rather than inline JavaScript, so static routing initializes under the same strict Content Security Policy as the portable server. Initial documents render without fetching JSON.

Every manifest-selected JSON payload is named by a digest of its serialized content. The portable server gives these payloads and Vite assets immutable cache headers while keeping the stable manifest revalidatable.

The compatibility entrypoint preserves URL fragments through a same-origin external redirect helper, with a visible destination link as its no-script fallback.

Every source file stores its raw text and highlighted lines once. Request-specific focus, context, and reference metadata stays in small separate payloads, so multiple links into one file do not duplicate its code.

`lat ui build static --logo-text <text>` persists the same plain-text override in the static manifest; without it, the exported client uses the bundled Lat wordmark.

An absolute `--base` path nests the payload under that path as well as prefixing its URLs, so the output directory itself remains the deployment root.

Entry assets use that base, while lazy JavaScript, CSS, fonts, and renderer chunks resolve relative to their owning production asset. Rich fences therefore work at both root and nested deployments.

Any existing output path is rejected before snapshot work begins, including an empty directory or prior export. `--force` explicitly replaces it, but only after the complete successor has staged successfully. Transient busy-file errors during the final move are retried; destinations that could contain the project remain forbidden.

## Builds a portable server deployment

`lat ui build server [output]` emits immutable public routes plus a portable Express application whose only dynamic feature is semantic search.

The build creates its vector index once and stores flat section metadata beside it. Runtime search copies the database to writable temporary storage, resolves results without Markdown parsing, and never rebuilds the index. A warm server instance reuses one database handle and embedder across queries, then closes the handle before deleting owned temporary storage.

The generated package directly imports and constructs its pinned Express version for framework detection, then passes that app to the shared runtime and delegates `npm start`, security headers, static caching, listening, and shutdown to `@lat.md/server`. No generated listener implementation is serialized into the artifact.

The entrypoint passes literal module-relative manifest and index URLs as real runtime inputs and injects a search-engine factory made from ordinary embedding-engine and model imports. The runtime derives the sibling `public/` directory from the manifest instead of exposing it to file tracing; CDN-aware hosts publish that root directory without duplicating it inside the function. Package-owned code loads its own WASM and model assets, so file tracing follows the actual runtime graph without include globs or tracing-only expressions.

Its static fallback preserves configured base paths, extensionless UI routes, and exact raw `.md` files on non-CDN hosts. `/` renders the configured entry document directly; `index.html` is only the physical file, and the former `/docs/...` route redirects to the root.

The static client exposes Search only when the build advertises an endpoint. Editing, Git state, event streams, repository access, and the runtime section command remain disabled.

### Runs the generated Node artifact end to end

The Node-target regression test builds a complete portable artifact, loads its generated entrypoint against installed workspace packages, and serves it over loopback HTTP.

It verifies the document shell, immutable JavaScript and CSS assets, and semantic results from the real local embedding model and built SQLite index. The test therefore covers the generated application contract rather than substituting a fake search handler.

## Selects server deployment targets

`lat ui build server [output] --target node|vercel` keeps Node as the portable default while making platform packaging explicit.

The `node` target defaults to `.lat-build/server/`. The `vercel` target defaults to `.vercel/output/`, builds the same Node artifact in temporary staging, installs production dependencies without lifecycle scripts, converts it into Build Output API v3, and removes staging. Output, base, force, and logo options apply to both.

## Builds Vercel output directly

The public Vercel target and repository preview convert an installed portable server artifact into Build Output API v3 without recursively invoking Vercel CLI.

`web/public/` becomes the CDN `static/` tree. Vercel's Node File Trace selects the entrypoint, server manifest, vector index, runtime packages, WASM engine, and model weights for one base-path-specific search function without copying public content into it.

Every runtime asset is reachable through a static import or `new URL(relativePath, import.meta.url)`. The embedding loader owns WASM initialization rather than relying on generated CommonJS glue to perform an opaque filesystem read.

The generated configuration applies the shared security policy, gives content-addressed JSON and Vite assets immutable caching, resolves functions and exact static files first, and maps extensionless routes to their physical `index.html` files.

## Keeps build-only packages out of runtime dependencies

The published CLI declares browser renderer inputs and test-only serializers as development dependencies because consumers execute prebuilt artifacts and should not install redundant source trees.

Node File Trace remains a runtime dependency because the installed CLI invokes it when users select the Vercel server target; the Vercel CLI itself is not required.

## Renders canonical document trees

Document, Git, section-output, reference, and highlighted-source APIs expose versioned JSON trees of safe root, element, and text nodes without legacy HTML fields.

Markdown, reStructuredText, and AsciiDoc normalize into the same protocol. Native external parse trees project directly without an HTML round trip; shared tree decoration marks external links, and the client rejects executable properties and unsafe URL protocols.

External-document repository links resolve against the document's source path. Files present in the project's explicit external set receive canonical routes; unavailable relative targets become visibly muted, non-interactive nodes.

Static export discovers and rewrites links by traversing node properties while retaining the same document-tree payload as the live server.

## Renders Markdown with navigable local links

Markdown normalizes into a safe tree with GitHub-style heading ids and intact relative destinations. HTTP(S) and protocol-relative links gain decorative external-site icons in documents and reference contexts.

Links wrapping images omit the external-site icon so badges and other linked embeds remain visually intact.

GitHub-flavored pipe tables render as semantic HTML tables. Wide tables stay within the document column and scroll horizontally instead of flattening into pipe-delimited text or widening the page.

Single- and double-tilde GitHub strikethrough syntax renders semantic deleted text rather than literal delimiters.

GitHub task-list markers render checked or unchecked disabled checkboxes with compact list alignment, preserving document readability without implying that the source file can be edited from the viewer.

Bare HTTP(S), `www.`, and email addresses render as links. Web addresses receive the same external-site treatment as explicit Markdown links, while trailing prose punctuation stays outside the destination.

GitHub-compatible raw HTML renders only through the sanitizer allowlist. Safe formatting and disclosure elements survive, while scripts, event handlers, and unsafe URL protocols never reach the client.

Fenced code blocks with supported language labels render escaped, server-side syntax-highlighted markup. Unknown labels remain safely escaped plain code.

Inline and display math render as accessible KaTeX after authored HTML has been sanitized, including display math written with dollar blocks or `math` code fences.

`mermaid` fences retain escaped source in server and static payloads, then lazily become React-owned SVG element trees in the browser. Invalid syntax leaves the source visible with a safe inline error instead of removing the block.

`geojson` and `topojson` fences replace source with a fixed-height loading shell before first paint, then lazily render their data over OpenFreeMap's hosted OpenStreetMap basemap. They retain visible attribution and fall back to an interactive local geometry view when tiles cannot load. Malformed data, renderer failures, and rejected lazy imports restore escaped source with a safe inline error and retry action.

ASCII `stl` fences lazily render as responsive 3D models with rotation, zoom, automatic framing, centered geometry, and a canvas constrained to its viewport at every pixel ratio. Invalid models or unavailable WebGL leave escaped source visible with a safe inline error.

GitHub `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION` alert blockquotes render as labeled callouts with type-specific color, while non-alert blockquotes retain their ordinary presentation.

GitHub footnotes render linked superscript references and a compact end section with return links, rather than being misread as ordinary Markdown reference links.

Recognized GitHub emoji shortcodes render as accessible Unicode emoji or GitHub custom emoji assets; unknown shortcodes stay literal, and rendering never rewrites the authored Markdown.

GitHub conversation references such as `#26`, `GH-26`, account mentions, and commit SHAs remain literal in Lat documents, matching repository-file rendering. Full GitHub URLs remain ordinary external links rather than conversation-only shortlinks or embeds.

## Shows a local table of contents

Markdown documents expose their H1 plus nested subsection headings in a sticky right rail on wide screens. The root entry stays bold without shifting subsection indentation; every entry links to its canonical fragment.

The fixed-width desktop rail fills the available viewport height without programmatic resizing. Its list stays content-height when short and scrolls without a visible scrollbar when long; fixed link metrics never compress, and short final sections activate in sequence.

Sections containing rendered Git changes carry an orange disc when Git is enabled, while sections owning validation errors carry a red disc. Both remain visible together when both states apply.

## Adapts navigation to mobile screens

Below 64rem, files remain reachable through a sticky two-row header and a scrollable full-viewport navigation overlay instead of a compressed or hidden desktop sidebar.

The overlay exposes its expanded state, uses touch-sized file targets, locks document scrolling while open, and closes on navigation, Escape, or a return to desktop width. Content gutters narrow, code scrolls horizontally without browser text inflation, and the graph stacks above its inspector.

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

Documents expose [[markdown#Frontmatter#require-code-mention]] separately from the rendered document tree so the browser can badge files that require code references.

## Edits local Markdown safely

Live local documents expose a View/Edit split control that swaps rendered Markdown for a soft-wrapped, syntax-highlighted CodeMirror surface without exposing editing in static exports or external documents.

The editor loads raw source on demand and writes only from its Save button or the platform save shortcut. Saving, saved, unsaved, and conflict states remain visible without blocking further typing.

Added, modified, and deleted lines receive subdued gutter markers against the last loaded or saved source. Markers clear when edits are reverted or saved and reset when clean content reloads from disk.

Leaving Edit, navigating away, or entering Graph requires confirmation while a draft is dirty. Reloading or closing the page requests the browser's native unsaved-changes confirmation, while canceled transitions keep the draft mounted.

Each save applies the user's delta from the last loaded or acknowledged text to the latest file content on disk. Unrelated concurrent changes survive, overlapping changes fail visibly while retaining the draft, and successful writes immediately refresh the live project snapshot.

### Does not replay uncertain writes

An interrupted editor PATCH becomes a visible error without automatic replay because the first request may already have reached disk; safe read requests retain their one retry.

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

Every section exposes a burger-icon menu with a count only when references exist. It lists distinct Markdown and code back-references or an empty state, and can navigate to and copy the section URL.

Muted actions stack below the references and can copy the URL or canonical ID accepted by `lat section`. In live views, the output modal defaults to the shared React tree renderer and offers a raw-text toggle; static exports omit this runtime-only action.

## Updates long-running views incrementally

Changing, adding, or deleting project files updates cached documents, navigation, source references, and backlinks without rereading unchanged Markdown files.

Browser clients receive a change event and refresh the current route while keeping its URL and viewport stable.

Internal parser, search, and external-source cache writes do not publish project generations or restart in-flight document requests.

### Accepts restarted server generations

Each event stream identifies its server lifetime, so reconnecting after a restart accepts reset generations and invalidates document and graph data from the prior process.

### Times out stalled document requests

A document request that never settles becomes a visible error with a retry action instead of leaving the route on an indefinite loading state.

### Recovers interrupted document requests

A transport-interrupted document request retries once. A repeated interruption becomes a visible retryable error, while navigation cancellations remain silent and never overwrite the next route.

## Refreshes search after Markdown changes

The first search indexes lazily, while a later Markdown generation triggers exactly one shared incremental indexing pass before new queries run.

## Shows live validation errors

Invalid Markdown files show a sidebar marker propagated through every ancestor directory, plus a top metadata error label whose entries jump to red-marked authored content.

The initial snapshot and every refresh recompute diagnostics from cached AST-free file analyses, removing markers immediately when errors are fixed.

## Shows live Git state

Git worktrees show cached HEAD changes as yellow modified or green new-file markers, split with red for validation errors, while rendered Markdown highlights removed and added words inline.

Every rendered block in a new Markdown file inherits the added state, including headings, unordered and ordered lists with their markers, and fenced code blocks.

Compatible table edits retain one rendered table, place inline additions and removals inside changed cells, and color inserted or deleted rows. Incompatible column or alignment changes fall back to colored whole-table replacements.

Changed inline math keeps its surrounding prose and marks the rendered old and new formulas inline. Display-dollar and fenced math changes remain rendered inside removed and added block treatments.

Blocks with less than 60% ordered word-token overlap render as whole removed and added blocks instead of noisy word-level replacements.

Startup reads Git once, and a later vault change refreshes that state. Polling also detects commits without filesystem events, clearing stale diff markers while unchanged Git snapshots remain silent.

The top Git toggle hides or reveals both sidebar markers and inline diffs without changing the underlying files.

The Git button retains an orange notification dot whenever changes exist, independent of the toggle state.

## Places context within a collapsed source window

Focused source views place reference context before the highlighted definition, keep five surrounding lines, and reveal collapsed code without moving the visible anchor.

## Highlights source syntax safely

Supported languages, including Dart and Java, become structured line trees without HTML serialization. HTML-like source remains inert text and multiline tokens retain their styling across every line.

## Builds a nested file tree

Vault paths form a natural-order hierarchy with root and directory index files pinned first and complete paths retained for navigation.

Selecting a directory opens its `name/name.md` index and keeps the directory expanded.

## Stabilizes fragment navigation immediately

Fragment links position rendered documents without smooth scrolling so content is immediately interactive.

Changing only a Markdown fragment preserves the mounted document and cached response through direct clicks and Back or Forward navigation, avoiding a loading state or full-content repaint.

Selecting the H1 entry in the page TOC keeps its canonical fragment while positioning the document at scroll-top zero instead of aligning the rendered heading.

### Preserves rich renderers

Fragment-only rerenders preserve the keyed React fence components, while a changed document tree updates or unmounts Mermaid, map, and STL resources through normal component lifecycle.

## Restores history scroll positions

In-app navigation records each viewport and restores it before revealing content reached through Back.

Search waits for asynchronous results before restoring its saved viewport.

## Rejects files outside the Markdown vault

The document API rejects traversal and non-Markdown targets so browser requests cannot read arbitrary project files.

## Launches the browser after the server starts

`lat ui` prefers loopback port 4242, advances when an implicit default is occupied, and starts listening before passing the final URL to the platform browser launcher.

An explicit `--port <number>` accepts 1–65535 and fails clearly rather than selecting another port when occupied. Startup reports the URL and points users to both deployment build targets.
