# Changelog

User-visible changes to Lat, grouped by feature release rather than internal implementation history.

## 0.13.0

Lat becomes a browsable, publishable graph with pinned upstream knowledge and much faster validation.

- Added [[browser|Lat UI]], graph exploration, rich Markdown rendering, conflict-aware editing, and static or Express-backed publishing.
- Added [[upstream|external sources]] for pinned Markdown, reStructuredText, AsciiDoc, and source-code targets.
- Added persistent parsed-file caches, concurrent analysis, lazy parser imports, and `lat check --profile`.
- Added ordinary Markdown-link validation, repository file and directory links, GitHub heading fragments, and stricter reference definitions.
- Added Dart and Java source symbols, search score debugging, and configurable similarity thresholds.

## 0.12

Semantic search became offline-first and Lat gained full Windows support.

- Bundled a local WASM embedding model with no API key or network requirement.
- Added `lat reindex` for rebuilding an index and selecting local or hosted embeddings.
- Added Windows CI and portable path behavior.

## 0.11

Agent setup expanded to Codex, OpenCode, and Cursor lifecycle hooks.

## 0.10

Source references became faster and more informative through ripgrep discovery and definition snippets in `lat section` and `lat refs`.

## 0.9

`lat init` began installing a Lat authoring skill for supported coding agents.

## 0.8

Pi integration and interactive setup menus made agent onboarding easier.

## 0.7

Rust, Go, and C source links joined `lat section`, `lat expand`, and section-structure validation.

## 0.6

Wiki links gained direct source-symbol targets such as `[[src/foo.ts#myFunction]]`.

## 0.5

Lat began suggesting initialization for unconfigured repositories and made root headings part of canonical section ids.
