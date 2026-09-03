# Lat UI

Lat UI turns a vault into navigable documentation for local development or static publishing.

## Browse locally

Start the loopback-only browser from a project root.

```bash
lat ui
```

`lat ui run` is the explicit form. Add `--no-git` when the project is not a worktree or the browser should ignore working-tree state.

The browser combines the file tree, document table of contents, backlinks, source definitions, validation state, Git diffs, semantic search, and graph view. It renders GFM, highlighted code, math, Mermaid, maps, and STL models.

Local Markdown has an editor with explicit, conflict-aware saves. Source files and [[upstream|external sources]] remain read-only.

## Publish

Choose a fully static site or a hybrid build with semantic search.

```bash
lat ui build static
lat ui build server
lat ui build server --target vercel
```

Both builds preserve documents, raw Markdown, source views, external previews, backlinks, validation, and graph navigation without live repository access. Static builds omit search; server builds add only a portable Express search API over a build-time index.

Static builds default to `.lat-build/static/`. The default `node` server target writes `.lat-build/server/`, with CDN-ready files in `public/`, search data in `server-data/`, and a small directly detectable Express entrypoint beside `package.json`. `npm start` uses the same `@lat.md/server` runtime as `lat ui`.

The `vercel` target writes `.vercel/output/` by default. It installs the generated Node artifact in temporary staging, traces only its search runtime into a function, and promotes static content into Vercel's CDN tree. Editing, Git state, live updates, and runtime commands remain omitted from both targets.
