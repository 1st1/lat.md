# Contributing to lat.md

Thanks for helping improve lat.md. This guide covers the local toolchain, the
development loop, and the checks expected on pull requests.

## Prerequisites

Install these tools before setting up the repository:

- Git.
- Node.js 22.
- pnpm through Corepack. The required version is declared by `packageManager`
  in the root `package.json`; pnpm is the only supported package manager for
  this workspace.
- Rust and Cargo installable through
  [rustup](https://rustup.rs/). The root `rust-toolchain.toml` selects stable
  Rust and installs the `wasm32-unknown-unknown` target used by the local
  embedding engine.

[ripgrep](https://github.com/BurntSushi/ripgrep#installation) is optional but
recommended for faster source-code reference scans. lat.md has a tested
TypeScript fallback when `rg` is unavailable.

## Set up the repository

After cloning the repository, run these commands from its root:

```bash
corepack enable

# Applies rust-toolchain.toml and installs its WebAssembly target.
pnpm setup:rust

pnpm install --frozen-lockfile
pnpm buildall
pnpm test
```

The first `pnpm buildall` downloads and builds the Rust tooling.  It also
downloads and converts the local embedding model which might take some time.

## Development process

Before changing code, use the knowledge graph to find the relevant design
intent and resolve any wiki references in the task:

```bash
pnpm exec lat search "topic or behavior"
pnpm exec lat expand "the task, including any [[refs]]"
```

Useful commands during development are:

```bash
pnpm test -- tests/parser.test.ts  # Run a focused test file once
pnpm test:watch                    # Run Vitest in watch mode
pnpm typecheck                     # Check TypeScript without emitting files
pnpm format                        # Format src/**/*.ts
pnpm format:check                  # Check formatting
pnpm build                         # Compile the root TypeScript package only
pnpm setup:rust                    # Prepare Rust target and local build tools
pnpm build:wasm                    # Rebuild the Rust/WASM engine only
pnpm build:weights                 # Rebuild or reuse the MiniLM model package
pnpm buildall                      # Build both workspace packages and the CLI
pnpm exec lat check                # Validate the knowledge graph and code refs
```

Set `LAT_FORCE_WEIGHTS=1` when running `pnpm build:weights` to download and
convert the model again instead of reusing existing artifacts.

Before opening or updating a pull request, run the same essential sequence as
CI:

```bash
pnpm buildall
pnpm test
pnpm exec lat check
```

`pnpm test` also exercises the typecheck and formatting checks. CI runs the
full build and Vitest suite on both Linux and Windows, so keep paths
cross-platform and text files LF-normalized.

## Website development

The website is not part of the root pnpm workspace. Install and run it from its
own directory:

```bash
cd website
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm build` there before submitting website changes.
