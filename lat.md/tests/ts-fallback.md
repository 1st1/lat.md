---
lat:
  require-code-mention: true
---

# TS Fallback

Tests that verify the pure-TypeScript code-ref scanner produces identical results to the ripgrep path.

## scanCodeRefs finds refs without rg

With `_LAT_DISABLE_RG=1`, `scanCodeRefs` still finds all `@lat:` refs in Python files, returning correct targets, file paths, and line numbers.

## checkCodeRefs detects dangling ref without rg

With `_LAT_DISABLE_RG=1`, `checkCodeRefs` still detects `@lat:` comments pointing to nonexistent sections.

## gitignore filtering works without rg

With `_LAT_DISABLE_RG=1`, `scanCodeRefs` still respects `.gitignore` rules, skipping ignored directories and returning only visible source files.

## findRefs with code scope works without rg

With `_LAT_DISABLE_RG=1`, `findRefs` with `code` scope still finds `@lat:` back-references for a given section.

## getSection includes code back-refs without rg

With `_LAT_DISABLE_RG=1`, `getSection` still populates `codeRefs` with `@lat:` back-references from source files.

## Bounded pool preserves source order

With more source files than the machine-derived fallback concurrency slots, the bounded TypeScript read-and-grep pool returns references in discovered file order rather than completion order.

## Matches ripgrep discovery semantics

The TypeScript and ripgrep paths return the same ordered files and references across nested ignore files, negations, dot paths, generated output, nested Lat projects, and scans outside Git checkouts.
