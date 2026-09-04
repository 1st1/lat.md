# @lat.md/stemmer

English Snowball stemming for Node.js, using the same `rust-stemmers` library as Tantivy. Ships a small WebAssembly binary with no runtime npm dependencies, model downloads, or install scripts. Rust is needed only to build from source.

```ts
import { stem, stemWords, STEMMER_VERSION } from '@lat.md/stemmer';

stem('running'); // 'run'
stemWords(['LINKS', 'files']); // ['link', 'file']
```

Inputs are individual words and are lowercased. The first nonempty call loads the bundled WASM synchronously; subsequent calls reuse it. `stemWords([])` returns an empty array. This package implements English stemming only, not tokenization, language detection, or synonyms.

Apply identical tokenization and stemming to indexed text and queries. Keep original text for display, embeddings, and citations. Preserve exact identifiers separately. `STEMMER_VERSION` identifies the analysis policy for index invalidation.

Build from the repository root with `pnpm --filter @lat.md/stemmer build`. The build reuses the repository's Rust/WASM toolchain and pinned wasm-bindgen CLI. Third-party licenses are included in `THIRD_PARTY_NOTICES`.
