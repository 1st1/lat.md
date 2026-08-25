# Browser Architecture

`lat view` serves the current vault on loopback and opens a prebuilt React client for local documentation browsing.

## Runtime boundary

[[src/cli/view.ts#viewCommand]] starts [[src/view/server.ts#startViewServer]] on an ephemeral port and launches the browser without a shell.

The installed runtime uses Node HTTP and prebuilt Vite assets. Read APIs accept only walked vault files or supported project source paths and reject traversal and escaping symlinks.

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
