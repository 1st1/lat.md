# Browser Architecture

`lat ui` serves the current vault on loopback, while `lat ui build` exports the same browser as an immutable static deployment.

## Runtime boundary

[[src/cli/ui.ts#uiCommand]] starts [[src/view/server.ts#startViewServer]] on loopback port 4242 and launches the browser without a shell. An occupied default advances to the next available port; an explicit `--port` is strict and reports the conflict.

The default top-left brand in both clients uses `website/public/logo-small.svg`, a navigation-sized variant of the website wordmark that omits its dithered cells and retains only solid cells. `--logo-text` replaces it with safely rendered plain text for the live server or static export.

The shared brand link and sibling action cluster opt out of browser selection in both normal and graph headers without changing their interaction semantics.

The browser follows the lat website's monochrome visual system: pure black or white foundations, neutral surfaces and borders, and restrained Vercel-style controls. Color is reserved for links, graph categories, syntax, and semantic Git or diagnostic state.

The installed runtime uses Node HTTP and prebuilt Vite assets. Browser renderer inputs remain development dependencies because Vite emits their code, styles, and fonts into the published lazy assets instead of making npm consumers install redundant source packages.

The server highlighter similarly bundles Lowlight with only Lat's supported Highlight.js grammars, keeping the full language set out of production dependencies.

Rich Markdown fences keep authored source as inert text nodes in document payloads. React-owned Mermaid, map, and 3D components lazily load browser-only renderers, so live and static documents degrade to readable code when a renderer cannot load or rejects input.

Map fences lazily request OpenFreeMap's hosted OpenStreetMap vector style through MapLibre. The authored GeoJSON or converted TopoJSON remains interactive over a local fallback when the basemap cannot load.

The live server's default-self Content Security Policy explicitly permits only OpenFreeMap tile connections, GitHub custom emoji images, and bundled data fonts needed by those supported renderers.

Read APIs accept only walked vault files or supported project source paths and reject traversal and escaping symlinks.

Local Markdown documents use extensionless `/docs/...` browser routes. Appending `.md` addresses the exact Markdown source instead, with `text/markdown` from the live server and a physical `.md` file in static exports so agents can read the vault without the React protocol.

## Document tree protocol

Document APIs carry one versioned, parser-neutral presentation tree so the browser can compose content as React elements instead of installing server-rendered HTML.

[[src/view/markdown.ts#renderMarkdown]] resolves Markdown semantics and converts mdast through the sanitizer, KaTeX, slug, and highlighting pipeline, then [[src/view/document-tree.ts#toViewDocumentTree]] retains only JSON-safe `root`, `element`, and `text` nodes. Parser positions, plugin objects, and executable properties never cross the boundary.

[[src/view/external-document-tree.ts#renderExternalDocumentTree]] projects reStructuredText nodes and Asciidoctor block and inline nodes directly into the same tree. Native renderers never serialize external documents to HTML for the server to parse again.

[[view/src/MarkdownContent.tsx#MarkdownContent]] recursively creates the React element tree, filters executable properties and unsafe URL protocols again, and mounts section menus and rich fences as stateful React components. It never uses `innerHTML` or `dangerouslySetInnerHTML`.

Rich fences remain `pre` and `code` elements with inert text children in the contract. [[view/src/MarkdownRichFence.tsx#MarkdownRichFence]] recognizes those nodes while reflecting the tree, owns every renderer resource through React effects, and restores the same source fallback on failure or unmount.

Source and fenced-code highlighting starts as Lowlight HAST and becomes document-tree nodes without HTML serialization. Multiline tokens are split structurally into independently renderable lines. Raw reStructuredText and AsciiDoc pass-through content remains inert text.

Static export traverses tree properties to discover linked source and external targets and to rewrite route URLs. It does not parse or edit serialized markup.

## Static export

[[src/cli/ui-build.ts#uiBuildCommand]] snapshots the current vault into a directory of HTML, JavaScript, CSS, and lazy JSON data that any ordinary static host can serve.

The export preserves the file tree, rendered Markdown, wiki and ordinary Markdown navigation, validation state, backlinks, source views, local TOCs, and the graph workspace. Each extensionless document and source path gets a physical `index.html` shell; every local document also has an exact `.md` source sibling. A compatibility shell migrates old graph URLs.

Each unique source file has one shared raw-text and highlighted-line payload. Manifest entries combine it with small request-specific payloads for focus, context, and references, avoiding code duplication across links into the same file.

The manifest stores the selected logo text with the document index so the static client renders the default wordmark or the same plain-text override as the live server.

The browser reads an immutable manifest instead of `/api/*`, never opens an event stream, and hides Git, search, and runtime command controls. Documents contain no Git diff projection, while graph nodes contain no Git status.

`--base /path/` prefixes routes, assets, and data and nests the physical payload under the same path, so deploying the output directory at a host's root serves the UI from that subpath. `/` is the default.

Vite emits lazy chunks, imported CSS, fonts, and renderer dependencies relative to their owning JavaScript or stylesheet. Generated route shells anchor only the entry assets at the configured base, so nested deployments do not leak requests to root `/assets/`.

Relative Markdown links are rewritten against their source document and then to extensionless UI routes, so the extra static route directory does not change their target or accidentally request raw Markdown. Both deployment entrypoints redirect to the exported index document.

Builds reject any existing destination, including an empty directory or prior export. For a new path, the builder stages the complete artifact beside the destination and renames it into place only after generation succeeds.

The generated marker makes later project-wide scans ignore the artifact instead of indexing rendered JSON or bundles as source. Any destination that could contain the project root is also rejected.

## Live Markdown editing

Live local documents can switch between the rendered tree and an editable Markdown source while static and external documents remain read-only.

[[view/src/MarkdownEditor.tsx#MarkdownEditor]] and its CodeMirror dependencies load only after Edit is selected. The editor provides soft wrapping, line numbers, history, Markdown syntax highlighting, and keyboard indentation without increasing production dependency installs.

CodeMirror incrementally compares the draft with the last loaded or saved source. A narrow gutter and subtle line tint distinguish added, modified, and deleted lines until a successful explicit save resets the baseline.

The editor writes only through its Save button or the platform save shortcut. Later keystrokes made during a request remain a dirty draft for another explicit save instead of being silently queued.

Switching to View, navigating to another document, or opening Graph asks before discarding a dirty draft. Browser reload and close use the native unsaved-changes prompt; same-document navigation preserves the mounted editor and its draft.

Each request carries the source originally loaded or acknowledged plus the user's edited source. [[src/view/document-edit.ts#applyDocumentEdit]] creates a contextual patch and applies it to the latest disk content, preserving unrelated concurrent changes while rejecting overlapping edits without discarding the browser draft.

The server serializes editor writes, verifies the target is a known real Markdown file inside the vault, replaces it atomically, and refreshes the live project snapshot before acknowledging the save.

## Live project index

A server-lifetime [[src/view/store.ts#createViewStore|ViewStore]] keeps document navigation and reverse references current without rescanning the project for every request.

At startup the store reads each Markdown file once through the shared [[architecture-analysis#File analysis|file analyzer]], scans code references once, and obtains the explicit supported-source inventory from [[src/code-refs.ts#createCodeReferenceDiscovery]] for its watch scope. It then resolves the cached AST-free facts into an immutable reverse-reference snapshot.

The store watches the project with a short debounce and serializes updates. Existing Markdown and code files are reread individually; file additions trigger a lightweight scope refresh, and deletions remove their cached contributions. Disposable `lat.md/.cache` writes are ignored at the watcher boundary.

Every update atomically replaces the snapshot. Section identity changes rebuild the global resolution maps and re-resolve cached occurrences from memory, but never force unchanged files to be reread or reparsed.

Each snapshot also validates cached Markdown links, wiki targets, section structure, and required code mentions. It consumes the analyzer's local diagnostics and adds project-wide findings; source lines let the client mark files, list errors, and highlight authored content.

Browser clients subscribe to snapshot generations over a heartbeated server-sent event stream. Ready and change events carry a server-lifetime identity, so reconnecting to a restarted process accepts its reset generation and invalidates old document and graph caches.

Document requests have a bounded wait and expose an explicit retry after transport failures. Every successful event-stream reconnection refreshes the index and active route even when the server generation did not change.

Markdown generations also dirty semantic search. The next query shares one incremental indexing pass across concurrent requests, then searches the updated index.

## Git working tree

When the vault belongs to a Git worktree, the server caches its [[src/view/git.ts#readViewGitSnapshot|HEAD comparison]] so Git subprocesses never run during document requests.

The initial snapshot runs Git once, using argument-array subprocesses without a shell. A debounced change anywhere inside `lat.md/` refreshes the full-vault diff together with porcelain status for untracked files; unrelated project changes reuse the cache.

An unreferenced two-second timer also refreshes Git through the store's serialized queue, catching commits and other repository-state changes that do not alter vault files. Unchanged snapshots neither increment the generation nor notify clients.

The client toggle controls both [[src/view/git-diff.ts#buildGitDiffTree|rendered diffs]] and sidebar state. Changed blocks use inline word diffs only with at least 60% ordered word-token overlap; otherwise the old and new blocks render separately.

Modified files are yellow, new files are green, and validation errors split the same marker red without hiding its Git state.

Whenever cached changes exist, the toggle keeps an orange notification dot whether Git rendering is enabled or hidden.

## Markdown navigation

[[src/view/markdown.ts#renderMarkdown]] produces the safe document tree with ordinary Markdown links, resolved wiki links, heading fragments, and Git or diagnostic presentation metadata.

Generated document links omit `.md`; the same route with `.md` is deliberately left to the browser as raw source. Relative links authored with `.md` are normalized to the extensionless UI route before rendering.

Markdown and source metadata rows align with the sidebar header, while source metadata retains clear space before the code panel.

Rendered sections use heading scale and whitespace without horizontal separators between headings.

Rendered link text is always underlined. A [[src/view/document-tree.ts#decorateExternalSiteLinks|parser-neutral tree pass]] adds external-link icons across Markdown, reStructuredText, and AsciiDoc, except when a link wraps an image; language badges, reference counts, and those icons remain undecorated.

Document responses project every parsed heading and canonical GitHub slug into a local TOC. Its H1 entry stays bold at the base indentation, while subsection indentation remains relative to the first subsection level.

TOC entries show an orange disc when their section contains a rendered Git change and a red disc when it owns validation errors. Git discs follow the Git visibility toggle; error discs remain visible.

Same-document fragment navigation updates history and scroll position without clearing, refetching, or remounting the rendered Markdown. The H1 TOC fragment positions the viewport at document scroll-top zero; source fragments remain part of route identity because they select code symbols.

Wide layouts give the sticky TOC a fixed 286px column and the available viewport height. Its list uses normal block flow, stays content-height when short, and scrolls behind a hidden scrollbar when long. Fixed link metrics never shrink to fit overflow.

A moving end-of-page activation line makes short final sections reachable.

The sidebar is a natural-order file tree. Root `lat.md` and each `name/name.md` directory index stay first; selecting a directory opens its index and expands the directory. When external files are referenced, an `External sources` label separates source-handle folders from the local tree.

Every section heading exposes a burger-icon action menu, with a numeric badge only when references exist. It shows incoming Markdown, wiki, and `@lat:` locations or an empty state, followed by stacked muted actions that copy the navigated URL or canonical section ID.

In live views, the menu can invoke [[src/cli/section.ts#sectionCommand|the shared `lat section` command path]] with plain styling. Its modal defaults to the React projection of the shared document tree and can switch to raw output; static exports omit only this execution action.

## Responsive layout

Below 64rem, the browser replaces desktop navigation rails with a persistent, touch-oriented header while preserving every route and control.

The first row keeps the logo and Git, Search, and Graph actions. A second row shows the current route and opens the file tree as an independently scrolling viewport overlay; navigation, Escape, or returning to desktop closes it and restores document scrolling.

Mobile content uses narrower gutters, fixed heading metrics, wrapped links, and horizontally scrollable code instead of shrinking text. The desktop TOC collapses into a sticky `On this page` row with its own scrollable list and preserved section state.

Selecting a collapsed TOC entry closes the list before positioning the heading. Its sticky-header offset keeps direct fragments visible below both mobile navigation rows and the TOC trigger.

The graph changes from a 50/50 workspace to a bounded canvas above its full-width inspector. Search inputs retain a zoom-safe font size and canvas, filter, navigation, and source controls keep touch-sized targets.

## Wiki-link reference counts

Every resolved wiki link with indexed references carries a compact count of distinct locations that reference its canonical target, sourced from the cached [[src/view/references.ts#buildViewReferenceIndex|reverse-reference snapshot]].

The total includes the current link. Markdown references deduplicate by source paragraph, while `@lat:` references deduplicate by source file and line, matching the count shown on target section headings.

Source-symbol links count references to that exact symbol. File-only source links aggregate references to the file and its symbols. Counts below two are omitted, while unresolved or ambiguous links remain authored text without a count.

The wiki-link resolver returns the target URL and count together, letting [[src/view/markdown.ts#renderMarkdown]] append a non-interactive badge inside the existing anchor without extra I/O or document rescans.

## Source navigation

Validated [[markdown#Wiki Links#Source Code Links]] open highlighted source definitions with the originating lat paragraph rendered as context.

The source view keeps five surrounding lines, collapses distant code, preserves the viewport when expanding upward, and links to other lat sections that reference the same symbol. Its source container fixes mobile text adjustment at the authored scale so line numbers and highlighted tokens stay uniform.

## Search and history

Search debounces embedding queries, links results to exact sections, and stores the latest query in the URL so Back restores it.

Escape clears a non-empty query, then returns to the page that opened search. Clicking the active Search icon closes search directly. In-app history records viewport positions and restores them before revealing returned Markdown, source, or search content.

## Graph workspace

[[graph#Graph View]] projects cached documents, source targets, and code mentions into a stable directed graph without rescanning at request time. Resolved section relationships roll up to their owning documents.

The client preloads the graph projection, ships its WebGL renderer in the main UI, and uses deterministic document/code clusters so the persisted presentation mode switches without I/O or layout work. Normal document/source URLs own selection and history; the embedding filter reuses `/api/search` and propagates cosine scores into result sizing.
