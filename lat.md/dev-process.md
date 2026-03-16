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

## File Walking

All directory walking goes through [[src/walk.ts#walkEntries]], the single entry point with `.gitignore` support that filters out `.git/` and dotfiles.

It wraps the `ignore-walk` npm package to ensure `.gitignore` rules are consistently honored everywhere. Results are not cached — each call re-walks the filesystem, which is necessary for long-lived processes like the MCP server.

[[src/code-refs.ts#walkFiles]] calls `walkEntries()` then additionally skips `.md` files, `lat.md/`, `.claude/`, and sub-projects (directories containing their own `lat.md/`).

[[src/cli/check.ts#checkIndex]] calls `walkEntries()` on the `lat.md/` directory itself to discover visible entries for index validation.

## Formatting

Prettier with no semicolons, single quotes, trailing commas. Run `pnpm format` before committing.

## Publishing

Published to npm as `lat.md`. The `bin` entry exposes the `lat` command. Only `dist/src` is included in the package — tests and the [[website]] are excluded.

### Release Process

Step-by-step procedure for cutting a release: version bump, changelog, PR, and npm publish.

1. **Compile changelog** — run `git log --oneline` since the last version bump commit (look for commits matching `Bump to X.Y.Z`) and summarize notable changes as bullet points. Only include user-facing features, fixes, and behavioral changes — skip doc-only updates, refactors, and other commits that don't affect functionality
2. **Sync main** — `git fetch` and rebase/merge to ensure local `main` is up to date with the remote before branching
3. **Create a release branch** — branch off `main`, e.g. `release/0.1.5`
4. **Bump version** — update `version` in `package.json`. Commit message: `Bump to X.Y.Z`
5. **Switch back to main** — check out `main` so the working tree is not left on the release branch
6. **Push main and open a PR** — push `main` first (so the release branch diff is clean), then push the release branch and create a PR with the changelog as the body
7. **Merge** — once CI passes and the PR is merged to `main`, the [[dev-process#Publishing#Publish Workflow]] takes over
8. **Update [[website]]** — add an entry to the "What's New" section in `website/app/page.tsx` with the version number and a brief summary of user-facing changes

Version numbers follow semver. While pre-1.0, bump the patch for fixes and the minor for features/breaking changes.

### Publish Workflow

GitHub Actions workflow at `.github/workflows/publish.yml`. Runs on every push to `main`:

1. **Detect version change** — compares `version` in `package.json` against the previous commit. If unchanged, skips all publish steps
2. **Run tests** — `pnpm install`, `pnpm build`, `pnpm vitest run`
3. **Publish to npm** — `pnpm publish --no-git-checks` using the `NPM_TOKEN` repository secret
4. **Create GitHub release** — tags `vX.Y.Z` and creates a GitHub release with auto-generated notes

Uses npm trusted publishing (OIDC) — no secrets needed. The `--provenance` flag signs and publishes the package using the GitHub Actions identity. The `lat.md` package is linked to the `1st1/lat.md` repo on npmjs.com under Settings → Publishing Access.
