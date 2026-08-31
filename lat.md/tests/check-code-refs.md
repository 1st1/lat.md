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

Ripgrep and the TypeScript fallback both scan every centrally registered source extension for `@lat:` comments and ignore markers in unsupported files while preserving the complete file inventory used by `lat check` statistics.
