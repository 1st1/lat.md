---
lat:
  require-code-mention: true
---

# View

Functional tests for the local browser server and `lat view` startup behavior.

## Serves the document index and browser shell

The loopback server exposes the visible Markdown file index, redirects its root to the vault index, and serves the bundled client for document routes.

## Renders Markdown with navigable local links

Markdown becomes safe HTML with GitHub-style heading ids while ordinary relative links retain their authored destinations and fragments.

## Exposes code-mention frontmatter as metadata

Documents expose [[markdown#Frontmatter#require-code-mention]] separately from rendered HTML so the browser can badge files whose leaf sections require code references.

## Resolves Markdown and source wiki links

Wiki links that resolve to Markdown sections or validated source definitions become client-side anchors. Code links carry compact language badges, unaliased links mute context through the final `#`, and unresolved targets retain their authored text.

Each visually split segment owns its underline so the decoration matches that segment's text color.

## Serves source definitions securely

Source routes return supported project files with optional symbol ranges for line highlighting while rejecting traversal, unsupported extensions, missing symbols, and files outside the project root.

## Shows source reference context

Source links preserve their originating section and line so the code view can show the breadcrumb and safely rendered paragraph, emphasize the selected code link, and navigate every link before exposing other referencing sections.

The `Other references` control sits centered in the lower divider of the context card, with expanded reference entries flowing beneath it.

## Shows section back-references

Every referenced section shows a count that expands into distinct linking Markdown paragraphs, wiki references, and `@lat:` code locations, with rendered context and exact source-line navigation.

## Places context within a collapsed source window

Focused source views place reference context directly before the highlighted definition, retain five surrounding lines, and offer controls that reveal code collapsed above or below the window.

## Highlights source syntax safely

Supported source languages receive server-side token coloring as independently valid HTML lines, while HTML-like source text stays escaped and multiline tokens retain their styling.

## Builds a nested file tree

Vault-relative Markdown paths become a directory-first hierarchy with alphabetized children and complete file paths for navigation.

## Stabilizes fragment navigation immediately

Fragment links position the newly rendered document without smooth scrolling so text selection and further link clicks work as soon as navigation completes.

## Rejects files outside the Markdown vault

The document API rejects traversal attempts and non-Markdown targets so browser requests cannot read arbitrary project files.

## Launches the browser after the server starts

The command starts listening before passing the loopback URL to the platform browser launcher and reports the same URL to the terminal.
