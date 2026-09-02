---
lat:
  require-code-mention: true
---
# Refs End-to-End

End-to-end tests for the `lat refs` command across multiple files.

## Finds referring sections via wiki links

Load multiple files, extract refs, and verify that sections containing wiki links targeting a given section are correctly identified.

## Source symbol query finds md sections

`findRefs` with a source symbol query like `src/app.ts#greet` returns `found` with the correct target id and lists markdown sections that contain wiki links to that symbol.

## File-level query finds all refs to that file

`findRefs` with a file-level query like `src/app.ts` (no `#` symbol) matches all wiki links targeting that file or any symbol within it, returning all referring markdown sections.

## Source query returns no-match for nonexistent file

`findRefs` with a source file path that doesn't exist on disk (e.g. `src/nonexistent.ts#foo`) falls through to section resolution, which also fails, returning `no-match`.
