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

## Rejects files outside the Markdown vault

The document API rejects traversal attempts and non-Markdown targets so browser requests cannot read arbitrary project files.

## Launches the browser after the server starts

The command starts listening before passing the loopback URL to the platform browser launcher and reports the same URL to the terminal.
