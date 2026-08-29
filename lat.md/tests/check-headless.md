---
lat:
  require-code-mention: true
---

# Check Explicit Directories

Functional tests cover validation of Markdown directories outside `lat.md/`.

## Profiles validation work

`lat check --profile` reports nested timings for every validator and its major
operations, including repeated-call counts and the slowest file or target.

## Keeps concurrent profile scopes separate

Overlapping validation work remains attributed to its own profiler parent, so
the timing hierarchy stays accurate when asynchronous operations interleave.

## Reuses check data across validators

A full `lat check` parses each Markdown file once, then shares the resulting
command-scoped data across concurrently running validators without persisting
it between runs.

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
