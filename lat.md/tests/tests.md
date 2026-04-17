# Tests

High-level test descriptions. Actual test code lives in `tests/`.

## Conventions

Shared patterns for writing and organizing tests in this project.

**Functional over unit.** Prefer functional tests that exercise real `lat` commands against fixture directories over isolated unit tests. Unit tests are only for low-level edge cases that are hard to cover through fixtures (e.g. inline `parseSections` edge cases in `tests/lattice.test.ts`).

**Fixture-based.** Validation scenarios are static directories under `tests/cases/`, each a self-contained mini-project. Mutating commands such as `lat init` use isolated temp directories and invoke the built CLI in child processes.

**Error cases use `error-` prefix.** Test fixture directories that assert error behavior are named with an `error-` prefix (e.g. `error-broken-links`, `error-stale-index`). Success/happy-path fixtures use plain descriptive names (e.g. `valid-links`, `short-ref`).

- [[section-parsing]] — Parsing markdown into hierarchical section trees
- [[ref-extraction]] — Extracting wiki link references from markdown files
- [[section-preview]] — Formatting section previews for terminal output
- [[check-md]] — Validating wiki links in lat.md markdown files
- [[check-links]] — Validating relative markdown links to local files
- [[check-code-refs]] — Validating @lat code references and coverage
- [[locate]] — Finding sections by exact, subsection, and fuzzy matching
- [[refs-e2e]] — End-to-end tests for the refs command
- [[search]] — Semantic search provider detection and RAG replay tests
- [[check-index]] — Validating directory index files
- [[expand]] — Expand command ref expansion and context block formatting
- [[ref-resolution]] — Wiki link and code ref resolution across vault subdirectories
- [[mcp]] — MCP server tool listing and tool call responses
- [[roundtrip]] — Parse → render fidelity for all markdown and wiki link features
- [[check-sections]] — Validating section leading paragraphs
- [[check-headless]] — Validating explicit Markdown directories
- [[section]] — getSection core function and formatSectionOutput formatter
- [[hook]] — Lifecycle hook context injection, conditional continuation, and setup merging
- [[init]] — Initialization defaults for local-first semantic search
- [[config]] — User-level configuration and repository embedding preference persistence
- [[ts-fallback]] — Pure-TypeScript code-ref scanner fallback without ripgrep
- [[external-sources]] — External source handles and local override navigation
- [[gen]] — Built-in template generation regression checks
