---
lat:
  require-code-mention: true
---

# Check Code Refs

Tests for validating `@lat:` code references and required code mention coverage.

## Detects dangling code ref

Given a source file with `@lat: [[Nonexistent]]`, [[cli#check#code-refs]] should report it as pointing to a nonexistent section.

## Detects missing code mention for required file

Given a `lat.md` file with [[markdown#Frontmatter#require-code-mention]] and a leaf section not referenced by any `@lat:` comment in the codebase, [[cli#check#code-refs]] should report the uncovered section.

## Scans only supported source files

`scanCodeRefs` and the separate `discoverSourceFiles` API share the central source-extension registry across ripgrep and TypeScript fallbacks. Unsupported files are neither searched nor included in the UI's source watch scope.

Git projects inspect tracked regular files; non-Git projects walk visible, non-ignored files.

## Scans Dart references around annotations

Dart `// @lat:` references retain their authored line numbers before ordinary declarations and between metadata annotations and declarations, and dangling targets remain normal code-reference errors.
