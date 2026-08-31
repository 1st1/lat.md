---
lat:
  require-code-mention: true
---

# Check Explicit Directories

Functional tests cover validation of Markdown directories outside `lat.md/`.

## Profiles validation work

`lat check --profile` reports nested timings for every validator and its major operations, including parser-module imports, repeated-call counts, and the slowest file or target.

## Keeps concurrent profile scopes separate

Overlapping validation work remains attributed to its own profiler parent, so
the timing hierarchy stays accurate when asynchronous operations interleave.

## Reuses check data across validators

A cold full `lat check` parses each Markdown file once, then shares the resulting command-scoped snapshot across concurrent validators and persists only its AST-free per-file facts for later commands.

## Profiles persistent parser cache hits

A warm profiled check reports one persistent-cache hit per Markdown file, an explicit skipped Markdown-analyzer import, and no parser work, proving lookup completes before worker or AST construction.

## Profiles persistent source cache hits

A warm profiled check reports source-symbol cache hits and no tree-sitter work, while a cold run distinguishes source reads, hashing, parsing, and publication.

## Separator disambiguates directory names

`lat check -- links` checks a directory named `links`, while `lat check links`
continues to select the `links` subcommand and search for `lat.md/`.

## Every subcommand accepts a directory

Each check subcommand accepts `-- <directory>` and runs only its own validator
against that explicit Markdown directory.

## Target syntax requires one directory

The explicit-target form rejects a missing directory or extra arguments after
`--`, keeping its grammar unambiguous.

## Default check runs every validator

`lat check -- <directory>` runs markdown, ordinary-link, code-reference, index,
and section-structure validation together.
