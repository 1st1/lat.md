---
lat:
  require-code-mention: true
---
# Check Explicit Directories

Functional tests cover validation of Markdown directories outside `lat.md/`.

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
