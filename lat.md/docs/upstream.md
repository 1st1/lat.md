# External sources

External sources make upstream documentation and code part of a validated project graph without copying those repositories into the project.

## Configure a source

`lat external add` is interactive without arguments or accepts a complete definition for automation.

```bash
lat external add node https://github.com/nodejs/node \
  --commit main \
  --prefix doc \
  --default-file-extension md \
  --strategy fetch
```

Lat resolves mutable refs to an immutable commit. A source may fetch individual files, use a managed partial checkout, or read a verified machine-local checkout override.

## Link it

Prefix a repository-relative document or source path with the configured handle.

```md
[[node:api/assert#Strict assertion mode]]
[[react:packages/react/src/ReactClient.js#createElement]]
```

Markdown, reStructuredText, AsciiDoc, and every supported source language can supply named fragments. The same targets work in `@lat:` comments.

## Use it everywhere

External links participate in validation, section output, prompt expansion, backlinks, MCP, the graph, [[browser|Lat UI]], and static exports.

Lat retrieves only files the graph references and caches them by source and commit. Canonical sources are pinned and read-only; local overrides can redirect one machine to a matching checkout without changing shared links.
