---
lat:
  require-code-mention: true
---

# Section

Tests for the `getSection` core function and `formatSectionOutput` formatter.

## Nonexistent section returns no-match

When the query doesn't match any section (even fuzzily), `getSection` returns `kind: 'no-match'` with empty suggestions.

## Full id resolves to section

Given a fully qualified section id like `lat.md/dev-process#Dev Process#Testing`, `getSection` returns the section with its raw markdown content.

## Short id resolves to section

Given a short-form id like `setup#Install` where the file stem is unique, `getSection` resolves it to the full section and returns its content.

## CLI accepts literal and GitHub heading syntax

`lat section` accepts literal Obsidian heading paths and GitHub-slugged paths, producing identical output with the canonical literal-heading section id.

## Section with no refs or links

A section that neither contains wiki links nor is referenced by other sections returns empty `outgoingRefs` and `incomingRefs`.

## Section with outgoing refs only

A section containing wiki links (like `[[dev-process#Testing]]`) returns those targets in `outgoingRefs` while `incomingRefs` is empty.

## Section with incoming refs only

A section that is referenced by wiki links from other sections returns those referrers in `incomingRefs` while `outgoingRefs` is empty.

## Section with both outgoing and incoming refs

Verifies that `formatSectionOutput` correctly renders the "Referenced by" block when a section has incoming references.

## Parent section aggregates descendant references

Requesting a parent section recursively includes outgoing references owned by descendant sections, plus code backlinks targeting any descendant.

## Reference summaries preserve leading paragraphs

Outgoing and incoming section lists render complete valid leading paragraphs rather than short previews, with a 300-character safety cap for invalid documents.

## Source refs include line range

`getSection` populates `outgoingSourceRefs` with `line` and `endLine` from the resolved symbol, so callers can display the full extent of a function or class.

## formatSectionOutput renders source ref line ranges

`formatSectionOutput` renders source code references with `file:startLine-endLine` when the symbol spans multiple lines, showing the full extent of the definition.

## formatSectionOutput marks source snippets as inline code

Outgoing source and code-backlink snippet lines use Markdown inline-code delimiters, including valid longer delimiters around source that contains backticks.

## formatSectionOutput includes all parts

`formatSectionOutput` produces styled output containing section id, location, raw content, "This section references" with outgoing refs, "Referenced by" with incoming refs, and "Referenced by code" with `@lat:` back-references.
