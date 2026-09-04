# Historical clone setup

The primary historical checkout is `b1391996e836a07e4bdaa636a366c5cd99d1449c`, the direct parent of RAG commit `02c3dbe`. Its package version is 0.12.2, but it is newer than the exact v0.12.2 release. Its search code, embedding source, and lockfile are identical to `d8ffa96`; the intervening commit only adds an unused stemmer package.

These commands describe the final setup used for the primary historical run. Paths are specific to this machine. Execute against a fresh destination, not an existing experiment.

```sh
export LAT_COMPARISON_SOURCE=/Users/yury/dev/vercel/lat
export LAT_COMPARISON_OLD=/tmp/lat-012-comparison/old
export LAT_COMPARISON_INSTALLED=/Users/yury/.local/share/fnm/node-versions/v22.19.0/installation/lib/node_modules/lat.md/node_modules

git clone --no-hardlinks "$LAT_COMPARISON_SOURCE" "$LAT_COMPARISON_OLD"
git -C "$LAT_COMPARISON_OLD" checkout --detach b1391996e836a07e4bdaa636a366c5cd99d1449c
```

Restore exactly the 39 audited Markdown files and verify their contents. No historical source files are replaced.

```python
import os, pathlib, json, shutil, subprocess, hashlib
main = pathlib.Path(os.environ['LAT_COMPARISON_SOURCE'])
root = pathlib.Path(os.environ['LAT_COMPARISON_OLD'])
audit = main / 'tests/cases/hybrid/real-query-audit'
corpus = json.loads((audit / 'corpus.json').read_text())
shutil.rmtree(root / 'lat.md')
for path in corpus:
    destination = root / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(subprocess.check_output(
        ['git', 'show', '72fbf5c:' + path], cwd=main))
subprocess.run(['git', 'apply', '--unidiff-zero', str(audit / 'corpus.patch')],
               cwd=root, check=True)
for path, expected in corpus.items():
    assert hashlib.sha256((root / path).read_bytes()).hexdigest() == expected, path
```

Create private dependency links. Never symlink the entire historical `node_modules` to the current one: that would load the new embedding package, which rejects oversized text instead of preserving historical truncation.

```python
import os, pathlib
main = pathlib.Path(os.environ['LAT_COMPARISON_SOURCE'])
root = pathlib.Path(os.environ['LAT_COMPARISON_OLD'])
installed = pathlib.Path(os.environ['LAT_COMPARISON_INSTALLED'])
modules = root / 'node_modules'
modules.mkdir()
for entry in (main / 'node_modules').iterdir():
    if entry.name != '@lat.md':
        (modules / entry.name).symlink_to(entry, target_is_directory=entry.is_dir())
(modules / '@lat.md').mkdir()
for entry in (main / 'node_modules/@lat.md').iterdir():
    if entry.name == 'embed':
        target = root / 'packages/embed'
    elif entry.name == 'embed-minilm-fp16':
        target = installed / '@lat.md/embed-minilm-fp16'
    else:
        target = entry
    (modules / '@lat.md' / entry.name).symlink_to(target, target_is_directory=True)
```

Compile the historical TypeScript and Rust sources. The target copy is only a build-cache optimization; Cargo detects changed inputs and recompiles the historical engine. `cp -cR` uses macOS copy-on-write, not a shared writable Cargo target. The project-local wasm-bindgen executable is reused at its Cargo.lock-pinned version.

```sh
cd "$LAT_COMPARISON_OLD"
node node_modules/typescript/bin/tsc -p packages/embed/tsconfig.json
cp -cR "$LAT_COMPARISON_SOURCE/packages/embed/crate/target" packages/embed/crate/target
ln -s "$LAT_COMPARISON_SOURCE/packages/embed/.cargo-tools" packages/embed/.cargo-tools
cd packages/embed
node scripts/build-wasm.mjs
node scripts/copy-wasm.mjs
cd "$LAT_COMPARISON_OLD"
node --import tsx "$LAT_COMPARISON_SOURCE/scripts/run-pre-rag-comparison.mjs" \
  "$LAT_COMPARISON_OLD" \
  /tmp/lat-012-comparison/old-results.json \
  "$LAT_COMPARISON_SOURCE/tests/cases/hybrid/real-query-audit"
```

The runner refuses an existing `.benchmark-cache` and verifies every corpus hash. It calls original `indexSections` and `searchSections` directly, preserving the original threshold of 0.35. Native limits five and ten are queried independently using the same per-query vector. No hosted services or keys are involved.

## Fidelity evidence

`dependency-evidence.json` records the exact old WASM and model hashes, installed versions, and checks that tracked `src/` and `packages/` are unmodified. Old embed is 0.2.0, model package is 0.1.0, libsql is 0.17.0, tsx is 4.21.0, and TypeScript is 5.9.3. The old and current arms use byte-identical MiniLM weights and tokenizer. The historical and current lockfile changes add new RAG dependencies without changing the historical libsql resolution.

This is an offline reconstruction with compatible dependencies linked from the existing installation, not a clean lockfile installation from a registry. The historical embedding package itself was built from historical source, including its historical input truncation behavior. The old WASM SHA256 is `f95681cfef453c2a4f84c965be9286725960f670de7143dc7c863f570401eba0`.

## Database locations

- Primary old quality index: `/tmp/lat-012-comparison/old/.benchmark-cache/vectors.db`.
- Current quality index: `/tmp/lat-012-comparison/new/comparison.db`.
- Exact-release secondary index: `/tmp/lat-012-comparison/release/lat.md/.cache/vectors.db`.
- Performance fresh indexes are separate temporary directories named `lat-reindex-old-*` and `lat-reindex-new-*`; quality indexes were not overwritten.

Before archiving an index, close connections and preserve any required WAL sidecars or checkpoint it. Performance runner closes its connections after execution.

Historical `lat check` was run and reports 33 expected failures because the synchronized newer documentation names post-baseline source symbols and test specifications. This does not imply corpus mismatch; all 39 content hashes pass. No source was changed to suppress those failures. The main checkout is validated separately.
