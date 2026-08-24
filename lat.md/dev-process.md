# Dev Process

Development workflow, tooling, and conventions for the lat.md project.

## Tooling

TypeScript ESM project (`"type": "module"`). Strict types enforced — `tsc --noEmit` runs as a [[dev-process#Testing#Typecheck Test]].

## Package Manager

pnpm is the only supported package manager. Never use npm or yarn.

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

Cross-platform correctness relies on two conventions: stored paths are always POSIX ([[src/walk.ts#toPosix]]), and a repo-root `.gitattributes` (`eol=lf`) keeps Windows checkouts from rewriting line endings and breaking the markdown roundtrip. Functional init tests run the built CLI and database seeding in child processes so native libsql handles close before temp cleanup. Lower-level tests that retain handles or spawn a fake `git` use [[tests/util.ts#rmDirBestEffort]].

## File Walking

All directory walking goes through [[src/walk.ts#walkEntries]], the single entry point with `.gitignore` support that filters out `.git/` and dotfiles.

It wraps the `ignore-walk` npm package to ensure `.gitignore` rules are consistently honored everywhere. Results are not cached — each call re-walks the filesystem, which is necessary for long-lived processes like the MCP server.

[[src/code-refs.ts#walkFiles]] calls `walkEntries()` then additionally skips `.md` files, `lat.md/`, `.claude/`, and sub-projects (directories containing their own `lat.md/`).

[[src/code-refs.ts#scanCodeRefs]] uses a two-tier strategy for finding `@lat:` comments: it first tries `rg` (ripgrep), falling back to a pure TypeScript implementation. When rg is available, it handles both searching and file listing — `walkFiles` is not called. Exclusions for `lat.md/`, `.claude/`, `*.md`, and sub-projects are passed as `--glob` args to rg. Sub-projects are detected upfront via `rg --files` (directories containing a nested `lat.md/`). The TS fallback uses `walkFiles` for both file discovery and exclusion filtering. `CodeRef.file` is always stored as a projectRoot-relative path; consumers convert to cwd-relative only at display time. Setting `_LAT_DISABLE_RG=1` forces the TS fallback; used in tests to cover both paths.

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

1. **Set up the toolchain** — Node 22 + pnpm, a Rust toolchain with the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli` pinned to the `Cargo.lock` version (`0.2.126`), needed to build the `@lat.md/embed` WASM engine. Also installs ripgrep (`apt-get install ripgrep`) so both the rg and TS-fallback code paths are exercised
2. **Build and test** — `pnpm install --frozen-lockfile`, then `pnpm buildall` (builds the WASM engine + fp16 weights + the top-level `lat` via `tsc`), then `pnpm vitest run`
3. **Publish changed packages** — a `publish_if_new` shell helper publishes each package **in dependency order** (`packages/embed-minilm-fp16` → `packages/embed` → root `.`), skipping any whose `version` is already on npm (checked via `npm view <name>@<version>`). Each publishes with `pnpm publish --provenance --access public --no-git-checks`. Because `workspace:*` is rewritten at publish time, publishing the leaf packages first guarantees the root's rewritten pins already resolve on npm
4. **Create GitHub release** — if a `vX.Y.Z` tag/release for the root version does not yet exist, creates one with auto-generated notes

Uses npm trusted publishing (OIDC) — no `NPM_TOKEN` secret needed. The `--provenance` flag signs each package using the GitHub Actions identity. Each package is linked to the `1st1/lat.md` repo on npmjs.com under Settings → Publishing Access.
