# Dev Process

Development workflow, tooling, and conventions for the lat.md project.

## Development Setup

Local development requires Git, Node.js 22, pnpm through Corepack, and Rust with Cargo installed through [rustup](https://rustup.rs/).

Rust compilation also requires the platform's native linker and build tools; rustup will prompt for these where needed.

The required pnpm version comes exclusively from `packageManager` in the root `package.json`. The root `rust-toolchain.toml` selects stable Rust and the `wasm32-unknown-unknown` target.

From the repository root, bootstrap and verify the full project with:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm setup:rust
pnpm buildall
pnpm test
```

`pnpm setup:rust` verifies the WASM target and installs the exact `wasm-bindgen-cli` version from `packages/embed/crate/Cargo.lock` under `packages/embed/.cargo-tools`. WASM builds run this setup automatically, so they never use a global CLI.

The first full build downloads Rust crates and the MiniLM source model, converts the model to fp16, and creates ignored WASM/model artifacts that later builds reuse. Hosted embedding credentials are not required.

Ripgrep is optional but recommended for faster source-reference scans; [[dev-process#File Walking]] provides a tested TypeScript fallback when `rg` is unavailable.

## Tooling

TypeScript ESM project with a Rust-to-WASM embedding engine. Local development mirrors CI so package builds and tests exercise the complete published toolchain.

The root workspace contains the TypeScript CLI, the `@lat.md/embed` Rust/WASM engine, the `@lat.md/embed-minilm-fp16` model package, and the `website/` Next.js app.

## Package Manager

pnpm is the only supported package manager. Never use npm or yarn.

## Contribution Workflow

Contributions start from the knowledge graph and keep its design and test specifications synchronized with meaningful implementation changes.

Before changing code, find the relevant intent and expand wiki references in the task:

```bash
pnpm exec lat search "topic or behavior"
pnpm exec lat expand "the task, including any [[refs]]"
```

Use `pnpm exec lat locate "Section Name"` for direct lookup. Update `lat.md/` for meaningful functionality, architecture, behavior, tests, or planned work; keep it a current snapshot rather than a changelog. Follow `AGENTS.md` for section and code-reference conventions.

Add or update tests with behavior changes. Important tests have a specification under `lat.md/tests/` and exactly one nearby `@lat:` comment in the corresponding test.

Before opening or updating a pull request, run:

```bash
pnpm buildall
pnpm test
pnpm exec lat check
```

Keep pull requests focused and explain user-visible behavior and rationale. Do not commit generated `dist/`, `model/`, `wasm-dist/`, `.cargo-tools/`, or Cargo `target/` artifacts. Version bumps are reserved for maintainer-led releases.

## Development Commands

The root scripts provide focused checks and builds as well as the complete CI-equivalent workflow.

- `pnpm test -- tests/parser.test.ts` — run a focused test file once
- `pnpm test:watch` — run Vitest in watch mode
- `pnpm typecheck` — check TypeScript without emitting files
- `pnpm format` — format `src/**/*.ts`
- `pnpm format:check` — check source formatting
- `pnpm build` — compile the root TypeScript package only
- `pnpm setup:rust` — prepare the Rust target and project-local build tools
- `pnpm build:wasm` — rebuild the Rust/WASM engine only
- `pnpm build:weights` — rebuild or reuse the MiniLM model package
- `pnpm buildall` — build both workspace packages and the CLI
- `pnpm exec lat check` — validate the knowledge graph and code references

Set `LAT_FORCE_WEIGHTS=1` when running `pnpm build:weights` to download and convert the model again instead of reusing existing artifacts.

## Testing

Vitest is the test runner. Tests live in the top-level `tests/` directory.

### Test Structure

Tests use fixture directories under `tests/cases/`, each a self-contained mini-project with its own `lat.md/` and source files.

See [[tests#Conventions]] for testing principles. The test harness in `tests/cases.test.ts` provides helpers (`caseDir()`, `latDir()`) to point `lat` functions at a given fixture.

### Running Tests

Commands for running the test suite.

- `pnpm test` — run all tests once
- `pnpm test:watch` — run in watch mode

### Typecheck Test

Every test run includes a full `tsc --noEmit` pass over the entire codebase. If it doesn't typecheck, it doesn't pass.

### Continuous Integration

CI (`.github/workflows/ci.yml`) runs the full `pnpm buildall` + `vitest` suite on a `[ubuntu-latest, windows-latest]` matrix (`fail-fast: false`) so platform-specific regressions — path separators (see [[parser#Short Ref Resolution]]) and line endings — are caught before release.

The separate graph-validation workflow installs and builds the workspace, then runs `lat check` through the checkout's built CLI. This lets unreleased parser and validation behavior verify the repository without third-party actions or the last npm release.

Cross-platform correctness relies on two conventions: stored paths are always POSIX ([[src/path.ts#toPosix]]), and a repo-root `.gitattributes` (`eol=lf`) keeps Windows checkouts from rewriting line endings and breaking the markdown roundtrip. Functional init tests run the built CLI and database seeding in child processes so native libsql handles close before temp cleanup. Lower-level tests that retain handles or spawn a fake `git` use [[tests/util.ts#rmDirBestEffort]].

## Website Development

The [[website]] is a root pnpm workspace package because its build compiles Lat and exports the repository vault before Next.js runs.

Website builds resolve the embedding engine and model from pinned npm releases through a dedicated TypeScript config. They compile the current CLI and UI without running the workspace Rust, WASM, or model builders.

```bash
pnpm install --frozen-lockfile
pnpm --filter lat-md-website dev
pnpm --filter lat-md-website build
```

## File Walking

All directory walking goes through [[src/walk.ts#walkEntries]], the single entry point with nested `.gitignore` support that excludes `.git/`, dotfiles, dot-directories, and symlinks before recursive traversal.

`walkEntries()` retains `ignore-walk`'s nested ignore-rule contexts but owns traversal itself. A bounded queue runs one asynchronous directory job per available CPU; each job uses `readdir` directory entries instead of per-entry `lstat` calls, filters files with file semantics only, and submits visible child directories back to the queue. Results are sorted after reduction, not cached, so long-lived processes such as the MCP server always observe the current filesystem.

Nearest-project discovery and Markdown file listing live in parser-free [[src/project-discovery.ts]]. Finding `lat.md/` walks ancestor paths without loading the directory walker; listing Markdown files dynamically loads `walkEntries()` only when enumeration is requested.

Pre-traversal filtering prevents transient files under dot-directories and dependency trees under `node_modules/` from racing or polluting non-Git project scans.

[[src/code-refs.ts#walkFiles]] calls `walkEntries()` then additionally skips `.md` files, `lat.md/`, `.claude/`, and sub-projects (directories containing their own `lat.md/`).

[[src/code-refs.ts#createCodeReferenceDiscovery]] exposes separate lazy operations for scanning `@lat:` comments and listing the supported source-file scope. The project-scoped object coalesces repeated calls and shares ripgrep exclusion discovery; [[src/code-refs.ts#scanCodeRefs]] and [[src/code-refs.ts#discoverSourceFiles]] are focused one-shot APIs for callers that need only one result.

Git projects enumerate their tracked regular source files once, excluding symlinks, sources beneath dot-directories, the root vault, and nested Lat projects, then give that identical ordered list to ripgrep or the TypeScript scanner. Untracked build output and ignored files therefore never enter project validation.

Outside Git, both operations first try `rg` (ripgrep), falling back to pure TypeScript discovery and scanning. Ripgrep honors nested `.gitignore` files, uses the fallback's case-insensitive ignore semantics, and excludes dot paths, Markdown, Lat documentation, dependency trees, and nested Lat projects. The [[src/source-formats.ts#SOURCE_FILE_EXTENSIONS|supported-source registry]] becomes a custom rg file type rather than positive globs, because positive globs can re-include ignored files. The UI requests the explicit source inventory for its live-update scope; `lat check` requests only references.

The TS fallback uses `walkFiles` for discovery and exclusion filtering, then reads and scans supported files through a bounded async pool with one slot per CPU available to the process. Both paths sort file and reference results by source position, so scheduling cannot reorder references or read diagnostics. `CodeRef.file` is always stored as a projectRoot-relative path; consumers convert to cwd-relative only at display time. Setting `_LAT_DISABLE_RG=1` forces the TS fallback; used in tests to cover both paths.

[[src/cli/check.ts#checkIndex]] calls `walkEntries()` on the `lat.md/` directory itself to discover visible entries for index validation.

## Formatting

Prettier with no semicolons, single quotes, trailing commas. Run `pnpm format` before committing.

## Publishing

A pnpm workspace publishing **three** npm packages: the root `lat.md` CLI and two supporting packages it depends on — `@lat.md/embed` (embedding engine) and `@lat.md/embed-minilm-fp16` (bundled local weights).

The `bin` entry exposes the `lat` command. Only `dist/src` and `templates` are included in the root package — tests and the [[website]] are excluded; the embed packages each ship their own `dist`.

The two `@lat.md/*` packages are runtime `dependencies` of the root, declared as `workspace:*`. `pnpm publish` rewrites `workspace:*` to the exact local version at publish time, so a released `lat.md` pins the embed packages by their real published versions.

### Release Process

Step-by-step procedure for cutting a release: version bump, changelog, PR, and npm publish.

1. **Compile changelog** — run `git log --oneline` since the last version bump commit (look for commits matching `Bump to X.Y.Z`) and summarize notable changes as bullet points. Only include user-facing features, fixes, and behavioral changes — skip doc-only updates, refactors, and other commits that don't affect functionality
2. **Sync main** — `git fetch` and rebase/merge to ensure local `main` is up to date with the remote before branching
3. **Create a release branch** — branch off `main`, e.g. `release/0.1.5`
4. **Bump versions** — update `version` in the root `package.json`. **Also bump any `@lat.md/*` workspace package whose source changed since its last publish** (compare `npm view <pkg> version` against the local `version`; inspect the published tarball if unsure). The [[dev-process#Publishing#Publish Workflow]] only republishes a package whose version is not already on npm, so a changed-but-unbumped package would silently ship stale to users while the root pins the old version. Commit message: `Bump to X.Y.Z`
5. **Switch back to main** — check out `main` so the working tree is not left on the release branch
6. **Push main and open a PR** — push `main` first (so the release branch diff is clean), then push the release branch and create a PR with the changelog as the body
7. **Merge** — once CI passes and the PR is merged to `main`, the [[dev-process#Publishing#Publish Workflow]] takes over

Version numbers follow semver. While pre-1.0, bump the patch for fixes and the minor for features/breaking changes. Each `@lat.md/*` package is versioned independently under the same rule.

### Publish Workflow

GitHub Actions workflow at `.github/workflows/publish.yml`. Runs on every push to `main`:

1. **Set up the toolchain** — Node 22 + pnpm and a Rust toolchain with the `wasm32-unknown-unknown` target. `pnpm buildall` installs the Cargo-locked `wasm-bindgen-cli` into the project. The workflow also installs ripgrep so both scan paths are exercised
2. **Build and test** — `pnpm install --frozen-lockfile`, then `pnpm buildall` (builds the WASM engine + fp16 weights + the top-level `lat` via `tsc`), then `pnpm vitest run`
3. **Publish changed packages** — a `publish_if_new` shell helper publishes each package **in dependency order** (`packages/embed-minilm-fp16` → `packages/embed` → root `.`), skipping any whose `version` is already on npm (checked via `npm view <name>@<version>`). Each publishes with `pnpm publish --provenance --access public --no-git-checks`. Because `workspace:*` is rewritten at publish time, publishing the leaf packages first guarantees the root's rewritten pins already resolve on npm
4. **Create GitHub release** — if a `vX.Y.Z` tag/release for the root version does not yet exist, creates one with auto-generated notes

Uses npm trusted publishing (OIDC) — no `NPM_TOKEN` secret needed. The `--provenance` flag signs each package using the GitHub Actions identity. Each package is linked to the `1st1/lat.md` repo on npmjs.com under Settings → Publishing Access.
