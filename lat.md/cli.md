# CLI

The `lat` command line tool. Entry point: `src/cli/index.ts`.

## locate

Find sections by query. Strips `[[brackets]]` and leading `#` from the query before searching. Results are returned in priority order:

1. **Exact match** — full section path matches (case-insensitive). If the query contains `#` (a full path) and matches exactly, returns immediately.
2. **File stem match** — for bare names (no `#`), the query is matched against file stems via `buildFileIndex`. e.g. `locate` matches the root section of `tests/locate.md`. For queries with `#`, the file part is expanded: `setup#Install` → `guides/setup#Install`. Results sorted by depth (shallower first) then path depth.
3. **Subsection match** — the query matches a trailing segment of a section id. e.g. `Frontmatter` matches `markdown#Frontmatter`. Skipped when the query contains `#`.
4. **Subsequence match** — query `#`-segments are a subsequence of the section id segments. e.g. `Markdown#Resolution Rules` matches `markdown#Wiki Links#Resolution Rules` (1 intermediate section skipped). Requires at least 2 query segments.
5. **Fuzzy match** — sections whose id or trailing segments are within edit distance (Levenshtein, max 40% of string length). e.g. `Frontmattar` matches `markdown#Frontmatter`. For queries with `#`, when the file part matches exactly, only the heading portion is compared — prevents the shared file prefix from inflating similarity (e.g. `cli#locat` matches `cli#locate` but not `cli#prompt`).

Outputs a [[cli#Section Preview]] for each match.

Usage: `lat locate <query>`

Implementation: `src/cli/locate.ts`, matching logic in `findSections()` in `src/lattice.ts`

## refs

Find sections that reference a given section via [[parser#Wiki Links]]. Requires an exact full-path match on the query (case-insensitive). If no exact match exists, shows "Did you mean:" suggestions from fuzzy/subsection matches and exits. Outputs a [[cli#Section Preview]] for each referring section.

Usage: `lat refs <query> [--scope=md|code|md+code]`

### Scope

- `md` (default) — search `lat.md` markdown files for wiki links targeting the query
- `code` — scan source files for `@lat: [[...]]` comments matching the query
- `md+code` — both

Implementation: `src/cli/refs.ts`

## check

Validation command group. Runs all checks when invoked without a subcommand.

Usage: `lat check [md|code-refs|index]`

Implementation: `src/cli/check.ts`

### md

Validate that all [[parser#Wiki Links]] in `lat.md` markdown files point to existing sections.

### code-refs

Two validations:
1. Every `// @lat: [[...]]` or `# @lat: [[...]]` comment in source code must point to a real section in `lat.md/`
2. For files with [[markdown#Frontmatter#require-code-mention]], every leaf section must be referenced by at least one `// @lat:` comment in the codebase

### index

Validate directory index files. Every directory inside `lat.md/` (including the root) must have an index file named after the directory (e.g. `lat.md/lat.md` for the root, `lat.md/api/api.md` for a subdirectory). Each index file must contain a bullet list covering every visible file and subdirectory with a one-sentence description, using the format `- **name** — description`.

Three checks:
1. **Missing index file** — errors with a ready-to-copy bullet list snippet
2. **Missing entries** — index file exists but doesn't list all visible entries
3. **Stale entries** — index file lists an entry that doesn't exist on disk

Directory walking uses [[dev-process#File Walking]] to respect `.gitignore` rules — hidden/ignored entries (`.cache`, `.obsidian`, etc.) are automatically excluded.

## prompt

Expand `[[refs]]` in a prompt text to resolved `lat.md` section paths with location context. Designed for coding agents to pipe user prompts through before processing.

Usage: `lat prompt <text>` or `echo "text" | lat prompt`

For each `[[ref]]` in the input, uses `findSections()` directly (no `resolveRef`):
1. **Best match** — resolves to the top result from `findSections` (exact > file stem > subsection > subsequence > fuzzy)
2. **No match** — errors out, tells the agent to ask the user to correct the reference

Output replaces `[[ref]]` with `[[resolved-id]]` inline and appends a `<lat-context>` block as a nested outliner. For exact matches: `is referring to:`. For non-exact: `might be referring to either of the following:` with all candidates, match reasons, locations, and body text.

Implementation: `src/cli/prompt.ts`

## gen

Generate a file to stdout from a built-in template.

Usage: `lat gen <target>`

Supported targets:
- `agents.md` — generate an `AGENTS.md` with instructions for coding agents on how to use `lat.md` in the project
- `claude.md` — alias for `agents.md`

Both targets output the same template from `templates/AGENTS.md`. The output is written to stdout so it can be redirected: `lat gen agents.md > AGENTS.md`.

Implementation: `src/cli/gen.ts`

## init

Interactive setup wizard. Walks the user through initializing lat.md in a project.

Usage: `lat init [dir]`

Steps:
1. **lat.md/ directory** — if not present, asks whether to create it. Scaffolds from `templates/init/` (`.gitignore` and `README.md`). If it already exists, skips ahead.
2. **AGENTS.md / CLAUDE.md** — if neither file exists, offers to generate both from the built-in template (same as [[cli#gen]]). If one or both already exist, suggests running `lat gen agents.md` to preview the template and incorporate manually.
3. **Claude Code prompt hook** — installs a `UserPromptSubmit` hook that injects a per-prompt reminder for the agent to consult lat.md via `lat search` and `lat prompt` before working. Copies `templates/lat-prompt-hook.sh` to `.claude/hooks/` and registers it in `.claude/settings.json`. Idempotent — detects if the hook is already configured and skips.

Implementation: `src/cli/init.ts`

## search

Semantic search across `lat.md` sections using vector embeddings.

Usage: `lat search [query] [--limit=5] [--reindex]`

Query is optional — `lat search --reindex` re-indexes without searching.

Implementation: `src/cli/search.ts`, core logic in `src/search/`

### Provider Detection

Requires an API key. The key is resolved in priority order by `resolveApiKey()` (`src/resolve-key.ts`):

1. `LAT_LLM_KEY` env var — direct value
2. `LAT_LLM_KEY_FILE` env var — path to a file containing the key (read and trimmed)
3. `LAT_LLM_KEY_HELPER` env var — shell command that prints the key to stdout (10 s timeout)

Provider is auto-detected from the resolved key prefix:
- `sk-...` — OpenAI (uses `text-embedding-3-small`, 1536 dims)
- `vck_...` — Vercel AI Gateway (uses `openai/text-embedding-3-small`, 1536 dims)
- `sk-ant-...` — Anthropic (not supported, errors with guidance)
- `REPLAY_LAT_LLM_KEY::<url>` — test-only replay server for offline testing

Implementation: `src/search/provider.ts`, `src/resolve-key.ts`

### Embeddings

Direct `fetch()` calls to the provider's OpenAI-compatible `/v1/embeddings` endpoint. No LangChain or other framework — keeps the dependency tree minimal. Batches up to 2048 texts per request.

Implementation: `src/search/embeddings.ts`

### Storage

Uses `@libsql/client` (Turso's libsql) in local file mode — pure JS/WASM, no native addons. Vector search is built into libsql via `F32_BLOB` column type, `libsql_vector_idx` for indexing, and `vector_top_k()` for KNN queries.

Single `sections` table holds metadata, content, content hash, and the embedding vector. No separate vector table needed.

The database is stored at `lat.md/.cache/vectors.db` and should not be committed (included in `.gitignore` template).

Implementation: `src/search/db.ts`

### Indexing

Sections are extracted via `loadAllSections()` + `flattenSections()`. For each section, the raw markdown between `startLine` and `endLine` is read (not just the `body` first-paragraph) for richer semantic signal.

Content freshness is tracked via SHA-256 hashes. On each run:
1. Parse all sections, compute hashes
2. Compare against stored hashes in the DB
3. Only re-embed new or changed sections (saves API cost)
4. Delete DB rows for sections that no longer exist

On first run, automatically indexes all sections. The `--reindex` flag forces a full rebuild.

Implementation: `src/search/index.ts`

### Vector Search

Embeds the user's query via the same provider, then runs a `vector_top_k()` KNN query joined back to the sections table.

Implementation: `src/search/search.ts`

## Section Preview

Shared output format used by [[cli#locate]], [[cli#refs]], and [[cli#search]]. Each section is rendered as a bullet (`*`) with:

1. Kind label (`File:` or `Section:`) — file root sections vs subsections
2. Section id in `[[wiki link]]` syntax (path segments dimmed, final segment bold)
3. Match reason in parentheses (e.g. `(exact match)`, `(section name match)`, `(fuzzy match, distance 2)`)
4. "Defined in" label with file path (cyan) and line range
5. Body text quoted with `>` (first paragraph, truncated at 200 chars)

Commands that return multiple results use `formatResultList()` which adds a bold header and consistent spacing.

Implementation: `src/format.ts` — exports `formatSectionId`, `formatSectionPreview`, and `formatResultList`
