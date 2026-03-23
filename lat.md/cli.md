# CLI

The `lat` command line tool. Entry point: [[src/cli/index.ts]].

**Design principle: shared core, thin wrappers.** Every CLI command and its corresponding [[cli#mcp]] tool share the same command function (e.g. `locateCommand`, `sectionCommand`, `refsCommand`). Each command function accepts a `CmdContext` (with a `Styler` abstraction for chalk vs plain formatting) and returns a `CmdResult` (`{ output, isError? }`). CLI and MCP are thin wrappers that construct the appropriate context and handle the result — CLI calls `handleResult` (print + exit code), MCP calls `toMcp` (wrap in MCP response). Some commands have a separate business-logic layer (e.g. `getSection`, `findRefs`, `runSearch`) that returns structured data, called by the command function. Shared types live in [[src/context.ts]]. Never duplicate business logic between CLI and MCP.

## locate

Find sections by query. Strips `[[brackets]]` and leading `#` from the query before searching. Results are returned in priority order:

1. **Exact match** — full section path matches (case-insensitive). If the query contains `#` (a full path) and matches exactly, returns immediately.
2. **File stem match** — for bare names (no `#`), the query is matched against file stems via `buildFileIndex`. e.g. `locate` matches the root section of `tests/locate.md`. For queries with `#`, the file part is expanded: `setup#Install` → `guides/setup#Install`. Results sorted by depth (shallower first) then path depth.
3. **Subsection match** — the query matches a trailing segment of a section id. e.g. `Frontmatter` matches `markdown#Frontmatter`. Skipped when the query contains `#`.
4. **Subsequence match** — query `#`-segments are a subsequence of the section id segments. e.g. `Markdown#Resolution Rules` matches `markdown#Wiki Links#Resolution Rules` (1 intermediate section skipped). Requires at least 2 query segments.
5. **Fuzzy match** — sections whose id or trailing segments are within edit distance (Levenshtein, max 40% of string length). e.g. `Frontmattar` matches `markdown#Frontmatter`. For queries with `#`, when the file part matches exactly, only the heading portion is compared — prevents the shared file prefix from inflating similarity (e.g. `cli#locat` matches `cli#locate` but not `cli#prompt`).

Outputs a [[cli#Section Preview]] for each match.

Usage: `lat locate <query>`

Implementation: [[src/cli/locate.ts]], matching logic in [[src/lattice.ts#findSections]]

## section

Show a section's full content including all subsections, along with outgoing and incoming wiki link references. Companion to [[cli#search]] — search gives RAG results, `section` lets you browse them by showing the full context of each result.

Accepts any valid section id (short-form, full-path, with or without `[[brackets]]`). Uses the same resolution logic as [[cli#refs]].

Output:

1. Section header with id and file location
2. Section content blockquoted (`>`) from `startLine` through the end of the last descendant subsection
3. **This section references** — all wiki link targets found within the section, including both lat.md section refs (with body descriptions) and source code refs (with file path and line range, e.g. `file.ts:10-25`, plus a 5-line snippet centered on the symbol)
4. **Referenced by** — other sections in `lat.md/` that contain wiki links pointing to this section
5. **Referenced by code** — source files containing `@lat:` comments that reference this section, each shown with file path, line number, and a 5-line snippet centered on the reference
6. **Navigation hints** — same footer as [[cli#search]], suggesting `lat section` and `lat search` as next steps

Usage: `lat section <query>`

Core logic in [[src/cli/section.ts#getSection]] (returns structured result), used by both the CLI command and [[cli#mcp]] `lat_section` tool.

## refs

Find sections that reference a given target via [[parser#Wiki Links]]. The query can be a section id or a source file path.

**Section queries** (e.g. `section-parsing#Heading`) are resolved via `findSections` when `resolveRef` doesn't produce an exact match, as long as the result is unambiguous (exact, stem-expanded, or section-name match). If no confident match exists, shows "Did you mean:" suggestions and exits.

**Source file queries** (e.g. `src/app.rs#greet`, `src/app.ts`) are detected when the file part has a recognized source extension and exists on disk. File-level queries (no `#`) match all wiki links targeting that file or any symbol in it. Symbol-level queries match exactly.

Outputs a [[cli#Section Preview]] for each referring section.

Usage: `lat refs <query> [--scope=md|code|md+code]`

### Scope

- `md` — search `lat.md` markdown files for wiki links targeting the query
- `code` — scan source files for `@lat: [[...]]` comments matching the query
- `md+code` (default) — both

Core logic in [[src/cli/refs.ts#findRefs]] (returns structured result), used by both the CLI command and [[cli#mcp]] `lat_refs` tool.

## check

Validation command group. Runs all checks when invoked without a subcommand.

Usage: `lat check [md|code-refs|index|sections]`

Emits a stale-init warning before any errors so the user sees setup issues first. The init version check compares `INIT_VERSION` in [[src/init-version.ts]] against the version in `lat.md/.cache/lat_init.json` written by [[cli#init]]. Missing LLM key warning appears only when all checks pass. If the total check took longer than one second and ripgrep is not installed, shows a tip suggesting the user install it for faster scanning. The first output line ("Scanned ...") includes the total elapsed time (e.g. "in 250ms" or "in 1.2s").

Implementation: [[src/cli/check.ts]]

### md

Validate that all [[parser#Wiki Links]] in `lat.md` markdown files point to existing sections.

### code-refs

Two validations:

1. Every `// @lat: [[...]]` or `# @lat: [[...]]` comment in source code must point to a real section in `lat.md/`
2. For files with [[markdown#Frontmatter#require-code-mention]], every leaf section must be referenced by at least one `// @lat:` comment in the codebase

### sections

Validate that every section has a well-formed leading paragraph. Two checks:

1. **Missing leading paragraph** — every section must have at least one paragraph before its first child heading. Sections with only headings and no prose are errors.
2. **Overly long leading paragraph** — the first paragraph must be ≤250 characters (excluding `[[wiki link]]` content). This guarantees the section's essence fits in search chunks and command output without truncation.

The character count strips all `[[...]]` wiki link syntax before measuring, so long link targets don't penalize the count.

### index

Validate directory index files. Every directory inside `lat.md/` (including the root) must have an index file named after the directory with a bullet list of its contents.

Each index file must contain a bullet list covering every visible file and subdirectory with a one-sentence description, using wiki links: `- [[name]] — description`. File entries omit the `.md` extension (e.g. `[[cli]]` not `[[cli.md]]`). Root example: `lat.md/lat.md`; subdirectory example: `lat.md/api/api.md`.

Four checks:

1. **Non-markdown files** — any file without a `.md` extension is flagged as an error (only markdown belongs in `lat.md/`)
2. **Missing index file** — errors with a ready-to-copy bullet list snippet
3. **Missing entries** — index file exists but doesn't list all visible entries
4. **Stale entries** — index file lists an entry that doesn't exist on disk

Only `.md` files participate in index validation — non-markdown files are reported separately and excluded from the directory listing.

Directory walking uses [[dev-process#File Walking]] to respect `.gitignore` rules — hidden/ignored entries (`.cache`, `.obsidian`, etc.) are automatically excluded.

## expand

Expand `[[refs]]` in text to resolved `lat.md` section paths with location context. Designed for coding agents to pipe user prompts through before processing. Renamed from `prompt` (which remains as a hidden deprecated alias).

Usage: `lat expand <text>` or `echo "text" | lat expand`

For each `[[ref]]` in the input, uses `findSections()` directly (no `resolveRef`):

1. **Best match** — resolves to the top result from `findSections` (exact > file stem > subsection > subsequence > fuzzy)
2. **No match** — errors out, tells the agent to ask the user to correct the reference

Output replaces `[[ref]]` with `[[resolved-id]]` inline and appends a `<lat-context>` block as a nested outliner. For exact matches: `is referring to:`. For non-exact: `might be referring to either of the following:` with all candidates, match reasons, locations, and body text.

Implementation: [[src/cli/expand.ts]]

## gen

Generate a file to stdout from a built-in template.

Usage: `lat gen <target>`

Supported targets:

- `agents.md` — generate an `AGENTS.md` with instructions for coding agents on how to use `lat.md` in the project
- `claude.md` — alias for `agents.md`
- `cursor-rules.md` — generate Cursor rules for `.cursor/rules/lat.md`
- `pi-extension.ts` — generate the Pi extension template (tools + lifecycle hooks)
- `skill.md` — generate the Agent Skills spec `SKILL.md` for the `lat-md` skill (authoring guide for `lat.md/` files)

Output is written to stdout so it can be redirected: `lat gen agents.md > AGENTS.md`.

Implementation: [[src/cli/gen.ts]]

## init

Interactive setup wizard. Walks the user through initializing lat.md in a project, with per-agent configuration for multiple coding tools.

Usage: `lat init [dir]`

Steps:

1. **lat.md/ directory** — if not present, asks whether to create it (via a one-off readline interface that is closed before step 2). Scaffolds from `templates/init/` (`.gitignore` and `README.md`). If it already exists, skips ahead.
2. **Agent selection** — interactive checklist menu ([[src/cli/checklist-menu.ts#checklistMenu]]). All agents are shown at once with `[x]`/`[ ]` checkboxes; the cursor row is highlighted with `chalk.bgCyan`. Keys: up/down (j/k) to move, Space to toggle, Enter to confirm, Ctrl+C to abort. Returns an array of selected agent values. Non-TTY fallback returns `[]`. After confirmation, prints a summary line (e.g. "Selected: Claude Code, Cursor" or dim "None"). **Important:** the persistent readline interface is created _after_ this step — `checklistMenu` puts stdin into raw mode with its own `data` listener, which corrupts any co-existing readline interface.
3. **Command style** — if any selected agent needs a lat command reference (all except Codex), a `selectMenu` asks "How should agents run lat?" with three options: `lat` (global install, portable), the resolved local binary path, or `npx lat.md@latest` (slow but zero-install). The choice determines what command string is written into hooks, MCP configs, and Pi extensions. Non-interactive mode defaults to `local`. Choosing `global` or `npx` makes generated config files portable and safe to commit.
4. **AGENTS.md** — created if a non-Claude agent is selected (Cursor, Copilot, Codex). Shared instruction file. Uses marker-based append mode (see below).
5. **Per-agent setup** — configures each selected agent (see subsections below). Each step prints a brief explanation of _why_ it's needed (e.g. why a hook is used instead of CLAUDE.md, why MCP is registered alongside CLI access).
6. **LLM key setup** — checks for an existing key (env var or [[cli#Configuration File]]), and if missing, interactively prompts the user to paste one. Explains what semantic search is and why a key is needed before asking.
7. **Version stamp + file hashes** — writes `INIT_VERSION` and SHA-256 hashes of all template-generated files to `lat.md/.cache/lat_init.json`. On re-run, compares current file content against stored hashes: unmodified files are silently updated to the latest template; user-modified files trigger a Y/n prompt offering to overwrite with the latest template, declining suggests [[cli#gen]].
8. **Next steps** — after all setup completes, prints agent-specific guidance for having the agent document the codebase. For Claude Code, shows a runnable `claude "..."` command. For IDE agents (Cursor, Copilot, Pi, OpenCode, Codex), shows the prompt to paste into agent chat. Both suggest running `lat check` when done.

At the very end, after all steps complete, init checks whether ripgrep (`rg`) is available. If missing, prints a tip suggesting the user install it for faster code scanning, with a link to the ripgrep installation guide.

At the very start, before any steps, init prints the ASCII `lat.md` logo (cyan, matching the website) followed by "Checking latest version..." and awaits [[src/version.ts#fetchLatestVersion]] (3s timeout). If a newer version exists, prints an update notice so the user can upgrade before proceeding. If the fetch fails or the version matches, the message is cleared silently.

### Claude Code

Sets up `CLAUDE.md` and two agent hooks for the Claude Code coding agent.

- `CLAUDE.md` — written using marker-based append mode (see below), preserving any user content outside the `%% lat:begin %%` / `%% lat:end %%` markers
- Hooks synced in `.claude/settings.json` — on every run, all existing lat-owned hook entries are removed, then fresh entries are added for both events. Detection uses three heuristics: `/\blat\b/` in the command string, `hook claude ` substring (catches any install path), or command starting with the current binary path. Non-lat hooks are preserved. Both hooks call [[cli#hook]]:
  - `UserPromptSubmit` → `lat hook claude UserPromptSubmit` — injects lat.md workflow reminders, auto-resolves `[[refs]]` in the prompt
  - `Stop` → `lat hook claude Stop` — reminds the agent to update `lat.md/` before finishing
- `.claude/skills/lat-md/SKILL.md` — skill spec generated from `templates/skill/SKILL.md`. Teaches the agent how to author and maintain `lat.md/` files. Claude Code discovers it automatically from `.claude/skills/`.
- `.claude` directory added to `.gitignore` (settings contain local absolute paths in hook commands)
- [[cli#mcp]] server registered in `.mcp.json` at the project root (added to `.gitignore` since it contains absolute paths)

### Pi

Sets up a Pi extension that registers lat tools as native Pi tools and hooks into the agent lifecycle.

- `AGENTS.md` — shared instruction file (created in the shared step)
- `.pi/extensions/lat.ts` — TypeScript extension generated from `templates/pi-extension.ts` with the full invocation command injected. `resolveLatBin()` in `init.ts` reconstructs exactly how the process was started: for compiled binaries it's just the binary path; for `.ts` source files run via tsx it captures `node <execArgv> <script>` so the same loader flags are replayed. Registers six tools (`lat_search`, `lat_section`, `lat_locate`, `lat_check`, `lat_expand`, `lat_refs`) that shell out to the `lat` CLI. Each tool provides a `renderCall` method so the Pi TUI displays the query/parameters inline in the tool call header (e.g. `lat search "query text"`). The `lat_search` and `lat_section` tools also provide a `renderResult` method that shows a collapsed preview (first 4 lines) by default and renders the full output as styled markdown (via pi's `Markdown` component and `getMarkdownTheme()`) when expanded via Ctrl+O (`expandTools` keybinding). Registers custom message renderers for `lat-reminder` and `lat-check` that show a collapsed one-liner by default and expand to full markdown-rendered content on Ctrl+O. Hooks into `before_agent_start` (injects a visible search reminder via `customType` message with `display: true`) and `agent_end` (runs `lat check` + diff analysis, sends a visible follow-up message if something needs fixing).
- `.pi/skills/lat-md/SKILL.md` — skill spec generated from `templates/skill/SKILL.md`. Teaches the agent how to author and maintain `lat.md/` files (section structure, wiki links, code refs, test specs). Pi discovers it automatically from the `.pi/skills/` directory.
- `.pi` directory added to `.gitignore` (extension and skills contain local paths)

### Cursor

Sets up `.cursor/rules`, a Cursor stop hook, and the MCP server for Cursor.

- `.cursor/rules/lat.md` — rules file generated from `templates/cursor-rules.md`, references MCP tools instead of CLI commands
- `.cursor/hooks.json` — generated stop hook config (`version: 1`) that runs `lat hook cursor stop`. It enforces the end-of-task `lat check` and `lat.md/` sync reminder in Cursor's native hook format.
- [[cli#mcp]] server registered in `.cursor/mcp.json`
- `.agents/skills/lat-md/SKILL.md` — skill spec for authoring `lat.md/` files, placed in the cross-agent standard skills directory

The `.cursor` directory is added to `.gitignore` because its hooks and MCP config may contain local paths. Cursor still relies on rules plus MCP for prompt-time search guidance because its hooks do not reliably inject prompt-specific context the way Claude/Pi integrations do.

### VS Code Copilot

Sets up `copilot-instructions.md` and registers the MCP server for VS Code Copilot.

- `.github/copilot-instructions.md` — instructions file written using marker-based append mode, preserving any user content outside the markers
- [[cli#mcp]] server registered in `.vscode/mcp.json`
- `.agents/skills/lat-md/SKILL.md` — skill spec for authoring `lat.md/` files, placed in the cross-agent standard skills directory

### OpenCode

Sets up an OpenCode plugin that registers lat tools as native OpenCode tools and hooks into the session lifecycle.

- `AGENTS.md` — shared instruction file (created in the shared step)
- `.opencode/plugins/lat.ts` — TypeScript plugin generated from `templates/opencode-plugin.ts` with the lat invocation command injected. Uses `@opencode-ai/plugin` to register six tools (`lat_search`, `lat_section`, `lat_locate`, `lat_check`, `lat_expand`, `lat_refs`) that shell out to the `lat` CLI. Hooks into `session.idle` (runs `lat check` + diff analysis, logs a warning via `client.app.log` if something needs fixing).
- `.agents/skills/lat-md/SKILL.md` — skill spec for authoring `lat.md/` files, placed in the cross-agent standard skills directory
- `.opencode` directory added to `.gitignore` (plugin contains local absolute paths)

### Codex

Sets up AGENTS.md, registers the MCP server, and installs skills for the Codex CLI agent.

- `AGENTS.md` — shared instruction file (created in the shared step)
- [[cli#mcp]] server registered in `.codex/config.toml` as a `[mcp_servers.lat]` TOML table
- `.codex` directory added to `.gitignore` (config contains local absolute paths)
- `.agents/skills/lat-md/SKILL.md` — skill spec for authoring `lat.md/` files, placed in the cross-agent standard skills directory
- `.codex/skills/lat-md/SKILL.md` — same skill spec in Codex's native skills directory

All setup steps are idempotent — existing configuration is detected and skipped.

`.gitignore` entries are only added if the target path is not already tracked in git (`git ls-files`); if tracked, the step prints a warning and skips to avoid a no-op ignore rule.

### Marker-based append mode

Shared files use `appendTemplateSection` to preserve user content outside lat's managed section.

Template content is wrapped in visible `%% lat:begin %%` / `%% lat:end %%` markers. Applies to CLAUDE.md, AGENTS.md, and `.github/copilot-instructions.md`. On re-run: if markers exist and the section matches, it's skipped ("already up to date"); if the section matches the stored hash (unmodified by user), it's replaced in-place; if the user edited the section, init asks before replacing. If the file exists but has no markers (old full-overwrite init), and the full-file hash matches the stored hash, the existing content is migrated to marker format in-place. If the file has user content and no markers, the section is appended to the end. All other agent files (rules, skills, hooks, extensions, plugins) still use full-file `writeTemplateFile` since lat owns those entirely.

Implementation: [[src/cli/init.ts]], checklist menu in [[src/cli/checklist-menu.ts]], single-select menu in [[src/cli/select-menu.ts]], version tracking in [[src/init-version.ts]]

## Configuration File

User-level configuration is stored in `~/.config/lat/config.json` (XDG Base Directory on Linux/macOS, `%APPDATA%\lat\config.json` on Windows). The `XDG_CONFIG_HOME` env var is respected if set.

Currently supports one field:

- `llm_key` — embedding API key for semantic search, used when `LAT_LLM_KEY` env var is not set

Key resolution order: `LAT_LLM_KEY` > `LAT_LLM_KEY_FILE` > `LAT_LLM_KEY_HELPER` > config file `llm_key`. This applies everywhere: `lat search`, `lat check`, and the MCP `lat_search` tool.

Implementation: [[src/config.ts]]

## hook

Handle agent hook events. Called by agent hooks configured during `lat init`, not directly by users.

Usage: `lat hook <agent> <event>`

Currently supports:

- `claude` with `UserPromptSubmit` and `Stop`
- `cursor` with `stop`

### UserPromptSubmit

Reads the hook input from stdin (JSON with `user_prompt`). Outputs JSON with `additionalContext` containing:

1. A directive to ALWAYS run `lat search` on the user's intent before starting work — even for seemingly straightforward tasks — because search may reveal critical design details, protocols, or constraints. Includes a hard gate: do not read files, write code, or run commands until search is done.
2. A reminder that `lat.md/` must stay in sync with the codebase — update relevant sections and run `lat check` before finishing.
3. If the prompt contains `[[refs]]`, resolves them inline using [[src/cli/expand.ts#expandPrompt]]
4. Runs [[src/cli/search.ts#runSearch]] on the user prompt, then [[src/cli/section.ts#getSection]] + [[src/cli/section.ts#formatSectionOutput]] on each result — the agent gets full section content with outgoing/incoming refs before it starts work. Gracefully degrades if no LLM key is configured.

### Stop

Conditionally blocks the agent from stopping — only when something is actually wrong.

1. **No `lat.md/` dir** — exit silently.
2. **Run `lat check`** — always, on both first and second pass.
3. **Second pass** (`stop_hook_active` true) — if check still fails, print warning to stderr (no block, loop stops). If check passes, exit silently.
4. **First pass** — run `git diff HEAD --numstat`. Count `codeLines` (files matching [[src/source-parser.ts#SOURCE_EXTENSIONS]]) and `latMdLines`. Skip ratio check if `codeLines < 5` or `latMdLines >= 50` (enough doc work was clearly done). Otherwise round `latMdLines` up to 1 (if nonzero) and flag `needsSync` when `latMdLines < codeLines * 5%`.
5. **Decision** — both pass: exit silently, clean output. Check failed + needs sync: block ("update `lat.md/`, then run `lat check` until it passes"). Check failed only: block ("run `lat check` until it passes"). Needs sync only: block with explicit context ("not updated" when 0 lat.md lines, "may not be fully in sync (N lines)" when some changes exist but below ratio).

### cursor stop

Runs the same `lat check` and diff analysis as Claude's `Stop` hook, but emits Cursor's `followup_message` payload instead of Claude's block response so the agent continues its loop in Cursor.

Implementation: [[src/cli/hook.ts]]

## mcp

Start the MCP (Model Context Protocol) server over stdio. Exposes lat.md tools to any MCP-capable coding agent (Claude Code, Cursor, VS Code Copilot).

Usage: `lat mcp`

Clients invoke this as `lat mcp`. The `lat init` wizard registers the MCP server using the absolute path to the current `lat` binary, so it works regardless of how `lat` was installed. The server exposes six tools:

- **lat_locate** — find sections by name (wraps [[cli#locate]])
- **lat_section** — show section content with outgoing/incoming refs (wraps [[cli#section]])
- **lat_search** — semantic search across sections (wraps [[cli#search]])
- **lat_expand** — expand `[[refs]]` in text (wraps [[cli#expand]])
- **lat_check** — validate links and code refs (wraps [[cli#check]])
- **lat_refs** — find references to a section (wraps [[cli#refs]])

Each MCP tool calls the same command function as the CLI (e.g. `locateCommand`, `refsCommand`, `searchCommand`), passing a `CmdContext` with `plainStyler` and `mode: 'mcp'`. The `toMcp()` helper converts `CmdResult` to MCP response format. Uses `@modelcontextprotocol/sdk` with stdio transport. Resolves `lat.md/` from cwd.

Implementation: [[src/mcp/server.ts]]

## search

Semantic search across `lat.md` sections using vector embeddings.

Usage: `lat search [query] [--limit=5] [--reindex]`

Query is optional — `lat search --reindex` re-indexes without searching. Results include a navigation hint footer suggesting `lat locate`, `lat refs`, and `lat search` for further exploration — this makes the tools self-documenting so agents discover them organically.

Core search logic in [[src/cli/search.ts#runSearch]] (returns matched sections), used by both the CLI command and [[cli#mcp]] `lat_search` tool. Indexing and embedding internals in `src/search/`.

### Provider Detection

Requires an LLM key resolved by [[src/config.ts#getLlmKey]] in priority order:

1. `LAT_LLM_KEY` env var — direct value
2. `LAT_LLM_KEY_FILE` env var — path to a file containing the key (read and trimmed)
3. `LAT_LLM_KEY_HELPER` env var — shell command that prints the key to stdout (10 s timeout)
4. `llm_key` from config file (see [[cli#Configuration File]])

Provider is auto-detected from the resolved key prefix:

- `sk-...` — OpenAI (uses `text-embedding-3-small`, 1536 dims)
- `vck_...` — Vercel AI Gateway (uses `openai/text-embedding-3-small`, 1536 dims)
- `sk-ant-...` — Anthropic (not supported, errors with guidance)
- `REPLAY_LAT_LLM_KEY::<url>` — test-only replay server for offline testing

Implementation: [[src/search/provider.ts]], [[src/config.ts]]

### Embeddings

Direct `fetch()` calls to the provider's OpenAI-compatible `/v1/embeddings` endpoint. No LangChain or other framework — keeps the dependency tree minimal. Batches up to 2048 texts per request.

Implementation: [[src/search/embeddings.ts]]

### Storage

Uses `@libsql/client` (Turso's libsql) in local file mode — pure JS/WASM, no native addons. Vector search is built into libsql via `F32_BLOB` column type, `libsql_vector_idx` for indexing, and `vector_top_k()` for KNN queries.

Single `sections` table holds metadata, content, content hash, and the embedding vector. No separate vector table needed.

The database is stored at `lat.md/.cache/vectors.db` and should not be committed (included in `.gitignore` template).

Implementation: [[src/search/db.ts]]

### Indexing

Sections are extracted via `loadAllSections()` + `flattenSections()`. For each section, the raw markdown between `startLine` and `endLine` is read (not just `firstParagraph`) for richer semantic signal.

Content freshness is tracked via SHA-256 hashes. On each run:

1. Parse all sections, compute hashes
2. Compare against stored hashes in the DB
3. Only re-embed new or changed sections (saves API cost)
4. Delete DB rows for sections that no longer exist

On first run, automatically indexes all sections. The `--reindex` flag forces a full rebuild.

Implementation: [[src/search/index.ts]]

### Vector Search

Embeds the user's query via the same provider, then runs a `vector_top_k()` KNN query joined back to the sections table.

Implementation: [[src/search/search.ts]]

## Section Preview

Shared output format used by [[cli#locate]], [[cli#refs]], and [[cli#search]]. Each section is rendered as a bullet (`*`) with:

1. Kind label (`File:` or `Section:`) — file root sections vs subsections
2. Section id in `[[wiki link]]` syntax (path segments dimmed, final segment bold)
3. Match reason in parentheses (e.g. `(exact match)`, `(section name match)`, `(fuzzy match, distance 2)`)
4. "Defined in" label with file path (cyan) and line range
5. Body text quoted with `>` (first paragraph, guaranteed ≤250 chars by [[cli#check#sections]])

Commands that return multiple results use `formatResultList()` which adds a markdown `##` heading and consistent spacing.

Implementation: [[src/format.ts]] — exports [[src/format.ts#formatSectionId]], [[src/format.ts#formatSectionPreview]], [[src/format.ts#formatResultList]], and [[src/format.ts#formatNavHints]]
