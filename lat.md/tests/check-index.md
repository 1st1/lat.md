---
lat:
  require-code-mention: true
---
# Check Index

Tests for validating `lat.md/` directory index files and subdirectory index files.

## Detects missing index file

Given a `lat.md/` directory with files but no index file (`lat.md`), `checkIndex` reports a missing-index error and includes a bullet-list snippet covering all visible entries.

## Passes with valid index

Given a `lat.md/` directory whose index file lists all visible entries with descriptions, `checkIndex` returns no errors.

## Detects stale index entry

Given an index file that lists a file which does not exist on disk, `checkIndex` reports it as a stale entry.

## Detects missing entries

Existing root and subdirectory indexes must list every visible Markdown child. Files omitted from those lists fail validation with the missing link entries, even though the UI keeps them navigable during editing.

## Detects missing subdirectory index file

Given a `lat.md/` directory with a subdirectory containing files but no index file for that subdirectory, `checkIndex` reports a missing-index error with a snippet listing the subdirectory's entries.

## Passes with valid subdirectory index

Given a `lat.md/` directory where both the root and a subdirectory have correct index files listing all visible entries, `checkIndex` returns no errors.

## Detects stale subdirectory index entry

Given a subdirectory index file that lists a file which does not exist on disk, `checkIndex` reports it as a stale entry.

## Detects non-markdown file

Given a checked directory containing an unreferenced file without a `.md` extension (e.g. `README`), `checkIndex` reports it as an error; non-Markdown files linked from vault Markdown are accepted as local resources.

## Non-markdown files excluded from index listing

Non-`.md` files do not appear in missing-entry suggestions or index snippets — only markdown files participate in index validation.
