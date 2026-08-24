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

## Resolves Markdown wiki links but leaves source links as text

Wiki links that resolve to Markdown sections become document anchors with aliases and heading fragments. Unaliased links mute context through the final `#`; source-code and unresolved targets retain their authored text.

Each visually split segment owns its underline so the decoration matches that segment's text color.

## Builds a nested file tree

Vault-relative Markdown paths become a directory-first hierarchy with alphabetized children and complete file paths for navigation.

## Rejects files outside the Markdown vault

The document API rejects traversal attempts and non-Markdown targets so browser requests cannot read arbitrary project files.

## Launches the browser after the server starts

The command starts listening before passing the loopback URL to the platform browser launcher and reports the same URL to the terminal.
