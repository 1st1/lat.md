# Browser Architecture

`lat ui` serves the current vault on loopback and opens a prebuilt React client for local documentation browsing.

## Runtime boundary

[[src/cli/ui.ts#uiCommand]] starts [[src/view/server.ts#startViewServer]] on an ephemeral port and launches the browser without a shell.

The installed runtime uses Node HTTP and prebuilt Vite assets. Its server highlighter bundles Highlight.js core with only Lat's supported languages, keeping the full package out of production dependencies.

Read APIs accept only walked vault files or supported project source paths and reject traversal and escaping symlinks.

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

The client toggle controls both [[src/view/git-diff.ts#buildGitDiffTree|inline word diffs]] and sidebar state. Modified files are yellow, new files are green, and validation errors split the same marker red without hiding its Git state.

Whenever cached changes exist, the toggle keeps an orange notification dot whether Git rendering is enabled or hidden.

## Markdown navigation

[[src/view/markdown.ts#renderMarkdown]] produces safe HTML with ordinary Markdown links, resolved wiki links, heading fragments, and `require-code-mention` metadata.

The sidebar is a natural-order file tree. Root `lat.md` and each `name/name.md` directory index stay first; selecting a directory opens its index and expands the directory.

Referenced sections expose incoming Markdown, wiki, and `@lat:` locations as navigable context.

## Source navigation

Validated [[markdown#Wiki Links#Source Code Links]] open highlighted source definitions with the originating lat paragraph rendered as context.

The source view keeps five surrounding lines, collapses distant code, preserves the viewport when expanding upward, and links to other lat sections that reference the same symbol.

## Search and history

Search debounces embedding queries, links results to exact sections, and stores the latest query in the URL so Back restores it.

Escape clears a non-empty query, then returns to the page that opened search. In-app history records viewport positions and restores them before revealing returned Markdown, source, or search content.
