# Browser Architecture

`lat ui` serves the current vault on loopback, while `lat ui build` exports the same browser as an immutable static deployment.

## Runtime boundary

[[src/cli/ui.ts#uiCommand]] starts [[src/view/server.ts#startViewServer]] on an ephemeral port and launches the browser without a shell.

The installed runtime uses Node HTTP and prebuilt Vite assets. Its server highlighter bundles Highlight.js core with only Lat's supported languages, keeping the full package out of production dependencies.

Read APIs accept only walked vault files or supported project source paths and reject traversal and escaping symlinks.

## Static export

[[src/cli/ui-build.ts#uiBuildCommand]] snapshots the current vault into a directory of HTML, JavaScript, CSS, and lazy JSON data that any ordinary static host can serve.

The export preserves the file tree, rendered Markdown, wiki and ordinary Markdown navigation, validation state, backlinks, source views, local TOCs, and the graph workspace. Each document, source path, and graph route gets a physical `index.html` shell.

Each unique source file has one shared raw-text and highlighted-line payload. Manifest entries combine it with small request-specific payloads for focus, context, and references, avoiding code duplication across links into the same file.

The browser reads an immutable manifest instead of `/api/*`, never opens an event stream, and hides Git and search controls. Documents contain no Git diff projection, while graph nodes contain no Git status.

`--base /path/` prefixes routes, assets, and data and nests the physical payload under the same path, so deploying the output directory at a host's root serves the UI from that subpath. `/` is the default.

Relative Markdown links are rewritten against their source document so the extra static route directory does not change their target. Both the deployment root and a non-root base directory redirect to the exported entry document.

Builds reject any existing destination, including an empty directory or prior export. For a new path, the builder stages the complete artifact beside the destination and renames it into place only after generation succeeds.

The generated marker makes later project-wide scans ignore the artifact instead of indexing rendered JSON or bundles as source. Any destination that could contain the project root is also rejected.

## Live project index

A server-lifetime [[src/view/store.ts#createViewStore|ViewStore]] keeps document navigation and reverse references current without rescanning the project for every request.

At startup the store reads each Markdown file once, extracts its sections, paragraphs, and outgoing links from one syntax tree, scans code references once, then resolves those cached occurrences into an immutable reverse-reference snapshot.

The store watches the project with a short debounce and serializes updates. Existing Markdown and code files are reread individually; file additions trigger a lightweight scope refresh, and deletions remove their cached contributions.

Every update atomically replaces the snapshot. Section identity changes rebuild the global resolution maps and re-resolve cached occurrences from memory, but never force unchanged files to be reread or reparsed.

Each snapshot also validates cached Markdown links, wiki targets, section structure, and required code mentions. Diagnostics carry source lines so the client can mark files, list errors in the top metadata, and highlight the authored content.

Browser clients subscribe to snapshot generations over server-sent events. A new generation refreshes the sidebar and current route while preserving the active URL and viewport.

Markdown generations also dirty semantic search. The next query shares one incremental indexing pass across concurrent requests, then searches the updated index.

## Git working tree

When the vault belongs to a Git worktree, the server caches its [[src/view/git.ts#readViewGitSnapshot|HEAD comparison]] so Git subprocesses never run during document requests.

The initial snapshot runs Git once, using argument-array subprocesses without a shell. A debounced change anywhere inside `lat.md/` refreshes the full-vault diff together with porcelain status for untracked files; unrelated project changes reuse the cache.

An unreferenced two-second timer also refreshes Git through the store's serialized queue, catching commits and other repository-state changes that do not alter vault files. Unchanged snapshots neither increment the generation nor notify clients.

The client toggle controls both [[src/view/git-diff.ts#buildGitDiffTree|rendered diffs]] and sidebar state. Changed blocks use inline word diffs only with at least 20% ordered word-token overlap; otherwise the old and new blocks render separately.

Modified files are yellow, new files are green, and validation errors split the same marker red without hiding its Git state.

Whenever cached changes exist, the toggle keeps an orange notification dot whether Git rendering is enabled or hidden.

## Markdown navigation

[[src/view/markdown.ts#renderMarkdown]] produces safe HTML with ordinary Markdown links, resolved wiki links, heading fragments, and `require-code-mention` metadata.

Markdown and source metadata rows align with the sidebar header, while source metadata retains clear space before the code panel.

Rendered sections use heading scale and whitespace without horizontal separators between headings.

Document responses project every parsed heading and canonical GitHub slug into a local TOC. Its H1 entry stays bold at the base indentation, while subsection indentation remains relative to the first subsection level.

Same-document fragment navigation updates history and scroll position without clearing, refetching, or remounting the rendered Markdown. Source fragments remain part of route identity because they select code symbols.

Wide layouts give the sticky TOC a fixed 286px column and the available viewport height. Its list uses normal block flow, stays content-height when short, and scrolls behind a hidden scrollbar when long. Fixed link metrics never shrink to fit overflow.

A moving end-of-page activation line makes short final sections reachable.

The sidebar is a natural-order file tree. Root `lat.md` and each `name/name.md` directory index stay first; selecting a directory opens its index and expands the directory.

Referenced sections expose incoming Markdown, wiki, and `@lat:` locations as navigable context.

## Wiki-link reference counts

Every resolved wiki link with indexed references carries a compact count of distinct locations that reference its canonical target, sourced from the cached [[src/view/references.ts#buildViewReferenceIndex|reverse-reference snapshot]].

The total includes the current link. Markdown references deduplicate by source paragraph, while `@lat:` references deduplicate by source file and line, matching the count shown on target section headings.

Source-symbol links count references to that exact symbol. File-only source links aggregate references to the file and its symbols. Counts below two are omitted, while unresolved or ambiguous links remain authored text without a count.

The wiki-link resolver returns the target URL and count together, letting [[src/view/markdown.ts#renderMarkdown]] append a non-interactive badge inside the existing anchor without extra I/O or document rescans.

## Source navigation

Validated [[markdown#Wiki Links#Source Code Links]] open highlighted source definitions with the originating lat paragraph rendered as context.

The source view keeps five surrounding lines, collapses distant code, preserves the viewport when expanding upward, and links to other lat sections that reference the same symbol.

## Search and history

Search debounces embedding queries, links results to exact sections, and stores the latest query in the URL so Back restores it.

Escape clears a non-empty query, then returns to the page that opened search. Clicking the active Search icon closes search directly. In-app history records viewport positions and restores them before revealing returned Markdown, source, or search content.

## Graph workspace

[[graph#Graph View]] projects cached documents, source targets, and code mentions into a stable directed graph without rescanning at request time. Resolved section relationships roll up to their owning documents.

The client preloads the graph projection, ships its WebGL renderer in the main UI, and uses deterministic document/code clusters so `/graph` switches without I/O or layout work. Its embedding filter reuses `/api/search`, propagates cosine scores into result sizing, and keeps selection in the URL.
