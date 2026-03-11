# Dev Process

## Tooling

TypeScript ESM project (`"type": "module"`). Strict types enforced — `tsc --noEmit` runs as a [[dev-process#Testing#Typecheck Test]].

## Package Manager

pnpm is the only supported package manager. Never use npm or yarn.

## Testing

Vitest is the test runner. Tests live in the top-level `tests/` directory.

### Test Structure

See [[tests#Conventions]] for testing principles. Tests use fixture directories under `tests/cases/`, each a self-contained mini-project with its own `lat.md/` and source files. The test harness in `tests/cases.test.ts` provides helpers (`caseDir()`, `latDir()`) to point `lat` functions at a given fixture.

### Running Tests

- `pnpm test` — run all tests once
- `pnpm test:watch` — run in watch mode

### Typecheck Test

Every test run includes a full `tsc --noEmit` pass over the entire codebase. If it doesn't typecheck, it doesn't pass.

## File Walking

All directory walking goes through `walkEntries()` in `src/walk.ts` — the single entry point that wraps the `ignore-walk` npm package with `.gitignore` support and filters out `.git/` and dotfiles. This ensures `.gitignore` rules are consistently honored everywhere.

`walkFiles()` in `src/code-refs.ts` calls `walkEntries()` then additionally skips `.md` files, `lat.md/`, `.claude/`, and sub-projects (directories containing their own `lat.md/`).

`checkIndex()` in `src/cli/check.ts` calls `walkEntries()` on the `lat.md/` directory itself to discover visible entries for index validation.

## Formatting

Prettier with no semicolons, single quotes, trailing commas. Run `pnpm format` before committing.

## Publishing

Published to npm as `lat.md`. The `bin` entry exposes the `lat` command. Only `dist/src` is included in the package — tests and the [[website]] are excluded.

### Release Process

How to publish a new version:

1. **Compile changelog** — run `git log --oneline` since the last version bump commit (look for commits matching `Bump to X.Y.Z`) and summarize notable changes as bullet points
2. **Create a release branch** — branch off `main`, e.g. `release/0.1.5`
3. **Bump version** — update `version` in `package.json`. Commit message: `Bump to X.Y.Z`
4. **Push and open a PR** — push the branch and create a PR with the changelog as the body
5. **Merge** — once CI passes and the PR is merged to `main`, the [[dev-process#Publishing#Publish Workflow]] takes over

Version numbers follow semver. While pre-1.0, bump the patch for fixes and the minor for features/breaking changes.

### Publish Workflow

GitHub Actions workflow at `.github/workflows/publish.yml`. Runs on every push to `main`:

1. **Detect version change** — compares `version` in `package.json` against the previous commit. If unchanged, skips all publish steps
2. **Run tests** — `pnpm install`, `pnpm build`, `pnpm vitest run`
3. **Publish to npm** — `pnpm publish --no-git-checks` using the `NPM_TOKEN` repository secret
4. **Create GitHub release** — tags `vX.Y.Z` and creates a GitHub release with auto-generated notes

Uses npm trusted publishing (OIDC) — no secrets needed. The `--provenance` flag signs and publishes the package using the GitHub Actions identity. The `lat.md` package is linked to the `1st1/lat.md` repo on npmjs.com under Settings → Publishing Access.
