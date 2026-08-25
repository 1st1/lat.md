---
lat:
  require-code-mention: true
---

# View Tests

Functional specifications for the local browser server, client navigation, and `lat ui` startup.

## Serves the document index and browser shell

The loopback server exposes the visible Markdown index, redirects its root to the vault index, and serves the client shell for document routes.

## Renders Markdown with navigable local links

Markdown becomes safe HTML with GitHub-style heading ids while ordinary relative links retain their destinations and fragments.

## Searches sections with embeddings

Search debounces embedding queries and renders ranked section summaries linked to their document anchors.

The URL preserves the latest query; Back restores it, and Escape clears the query before returning to the page that opened search.

## Exposes code-mention frontmatter as metadata

Documents expose [[markdown#Frontmatter#require-code-mention]] separately from rendered HTML so the browser can badge files that require code references.

## Resolves Markdown and source wiki links

Resolved Markdown sections and validated source definitions become client-side links, while unresolved wiki targets remain authored text.

Unaliased code links show a language badge and visually separate muted path context from the final target.

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

## Places context within a collapsed source window

Focused source views place reference context before the highlighted definition, keep five surrounding lines, and reveal collapsed code without moving the visible anchor.

## Highlights source syntax safely

Supported languages receive server-side token coloring while HTML-like source remains escaped and multiline tokens retain their styling.

## Builds a nested file tree

Vault paths form a natural-order hierarchy with root and directory index files pinned first and complete paths retained for navigation.

Selecting a directory opens its `name/name.md` index and keeps the directory expanded.

## Stabilizes fragment navigation immediately

Fragment links position rendered documents without smooth scrolling so content is immediately interactive.

## Restores history scroll positions

In-app navigation records each viewport and restores it before revealing content reached through Back.

Search waits for asynchronous results before restoring its saved viewport.

## Rejects files outside the Markdown vault

The document API rejects traversal and non-Markdown targets so browser requests cannot read arbitrary project files.

## Launches the browser after the server starts

`lat ui` starts listening before passing the loopback URL to the platform browser launcher and reports the same URL to the terminal.
