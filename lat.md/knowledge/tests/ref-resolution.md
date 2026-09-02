---
lat:
  require-code-mention: true
---

# Ref Resolution

Tests for wiki link and code ref resolution across vault subdirectories — ambiguous short refs, unique short refs, and fully qualified refs.

## Ambiguous short ref in md

When two directories contain a file with the same stem (e.g. `alpha/notes.md` and `beta/notes.md`), a wiki link using just the short name `[[notes#Topic A]]` is flagged as ambiguous by `check md`.

The error lists both candidate full paths so the user can pick the right one.

## Ambiguous short ref unique section

When a section exists in only one of the duplicate-stem files (e.g. `Topic C` only in `alpha/notes.md`), a short ref `[[notes#Topic C]]` is still flagged as ambiguous because two files named `notes.md` exist.

The error message suggests the specific fix (`did you mean "[[alpha/notes#Topic C]]"?`) along with listing all matching file paths.

## Ambiguous short ref in code

When two directories contain a file with the same stem, a `@lat:` code comment using the short name (e.g. `// @lat: [[notes#Topic A]]`) is flagged as ambiguous by `check code-refs`, with an error listing both candidate full paths.

## Short ref passes check md

When a file stem is unique in the vault (e.g. only one `setup.md` exists, under `guides/`), wiki links using `[[setup#Install]]` or `[[setup.md#Install]]` pass `check md` without errors.

## Wiki links accept literal and GitHub headings

`lat check md` accepts both `[[file#Some Section!]]` and `[[file#some-section]]`, resolving both to the same canonical literal-heading section id.

## Short ref passes check code-refs

When a file stem is unique in the vault, `@lat:` code comments using `[[setup#Configure]]` or `[[setup.md#Configure]]` pass `check code-refs` without errors.

## Short ref findSections resolves

`findSections` resolves short refs like `setup#Install` and `setup.md#Install` to the full vault-relative section `guides/setup#Install` and returns the matching section.

## Short ref refs finds md references

`lat refs` for a short ref target finds wiki link references from markdown files that use the short form.

## Short ref refs finds code references

`lat refs` for a short ref target finds `@lat:` code references that use the short form.

## Full ref passes check md

A wiki link using the full vault-relative path `[[guides/setup#Install]]` passes `check md` without errors.

## Full ref passes check code-refs

A `@lat:` code comment using the full vault-relative path `[[guides/setup#Configure]]` passes `check code-refs` without errors.

## Windows-style backslash refs pass

A `@lat:` code comment whose file portion uses Windows-style backslashes resolves to the canonical POSIX section id, preserving references generated before v0.12.1.

## Full ref findSections resolves

`findSections` resolves a full vault-relative ref like `guides/setup#Install` and returns the matching section.

## Full ref refs finds md references

`lat refs` for a full ref target finds wiki link references from markdown files that use the full path form.

## Full ref refs finds code references

`lat refs` for a full ref target finds `@lat:` code references that use the full path form.

## Bare heading in md is error

A wiki link `[[Installation]]` where `Installation` is a heading (not a file) is flagged as a broken link by `check md`. Bare names resolve as file references in Obsidian convention — since no file `Installation.md` exists, it's an error.

## Local section syntax in md is error

A wiki link `[[#Configuration]]` using Obsidian local-section syntax is flagged as a broken link by `check md`. The `#`-prefixed form is not supported — use the full `[[file#Heading]]` form instead.

## Nonexistent file ref in md is error

A wiki link `[[other-file#Missing]]` where `other-file.md` does not exist is flagged as a broken link by `check md`.

## Bare heading in code is error

A `@lat:` code comment `// @lat: [[Installation]]` where `Installation` is a heading (not a file) is flagged as a dangling ref by `check code-refs`. Code refs must use `[[file#Heading]]` form.

## Valid code ref with file prefix passes

A `@lat:` code comment `// @lat: [[docs#Configuration]]` using the correct `file#Heading` form passes `check code-refs` without errors.

## Nested in-file refs pass

Wiki links using the full heading chain within the same file (e.g. `[[guide#Setup#Prerequisites]]`, `[[guide#Usage#Basic]]`) pass `check md` without errors.

## Skipped intermediate in ref is error

A wiki link `[[guide#Prerequisites]]` that skips the intermediate `Setup` section is flagged as a broken link by `check md`. The full path `[[guide#Setup#Prerequisites]]` is required.

## Wrong nesting order in ref is error

A wiki link `[[guide#Install#Setup]]` with headings in the wrong order is flagged as a broken link by `check md`.

## Nonexistent leaf in nested ref is error

A wiki link `[[guide#Setup#Missing]]` where the leaf heading does not exist is flagged as a broken link by `check md`.
