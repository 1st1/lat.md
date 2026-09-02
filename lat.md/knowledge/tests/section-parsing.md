---
lat:
  require-code-mention: true
---
# Section Parsing

Tests for parsing markdown into hierarchical section trees with correct metadata.

## Builds a section tree from nested headings

Parse a markdown file with nested headings and verify the resulting tree has correct ids, depths, parent-child relationships, and file stems.

## Populates position and firstParagraph fields

Verify that `startLine`, `endLine`, and `firstParagraph` are correctly extracted from heading positions and first-paragraph text.

## Renders inline code in firstParagraph

Verify that inline code (backtick-wrapped) in a paragraph is preserved in the section `firstParagraph` field.

## Renders wiki links in firstParagraph

Verify that wiki links in a paragraph are rendered as `[[target]]` in the section `firstParagraph` field.
