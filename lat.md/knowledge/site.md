# Site

The public `lat.md` website is a hybrid Lat UI export of this repository's own vault, with immutable CDN-ready content and semantic search from a portable Express app.

## Content model

The site and the maintained knowledge graph are the same files, so public documentation can link directly into the engineering knowledge that governs Lat.

The root `lat.md/lat.md` is the landing page. `docs/` contains concise user documentation, `changelog.md` records releases, and `knowledge/` contains the internal architecture and test specifications that drive development.

The bundled Lat wordmark appears in the browser header. The landing page references its own vault-local logo beside live CI and GitHub-star badges, so the same Markdown stays portable across live and exported views.

## Build and deployment

`pnpm build:site` hydrates the exact published embedding engine and model artifacts, builds Lat and its browser assets, then runs `lat ui build server --force`. Hosted builds need Node and pnpm, not Rust.

`pnpm build:site:source` rebuilds the workspace embedding packages first for engine or model development. The ordinary site build verifies npm artifact versions against the workspace manifests and disables package lifecycle scripts.

The command emits one ignored `.lat-build/server/` artifact. Its own `public/` is the generated static tree.

`lat ui build server --target vercel` performs the portable build, dependency installation, and direct Build Output API v3 conversion for ordinary projects. `pnpm build:site:vercel` uses the same converter but vendors this branch's workspace packages first for preview fidelity.

The converter promotes `.lat-build/server/public/` into the CDN static tree and uses Vercel's Node File Trace to assemble the search runtime, index, WASM engine, and model weights into a Node function. Runtime assets use analyzable module-relative URLs; public content is never duplicated inside the function.

The Vercel project uses the Other preset with `pnpm build:site:vercel` as its build command and no output-directory override. The checkout emits `.vercel/output` without a root application, Vercel manifest, nested CLI invocation, project link, or deployment token.

Vercel's Git integration runs the sole site build and creates previews in a separate project. GitHub Actions validates the code. The legacy production project remains disconnected from GitHub until a later manual domain cutover.

The portable artifact passes its generated manifest and index URLs directly to the server runtime and injects the local search engine through ordinary package imports. Its runtime infers the static fallback from the artifact layout, leaving `public/` available for CDN promotion. Content-addressed JSON and Vite assets remain stable across deployments.

The index is built once with Lat's local WASM model. Each serverless instance copies the database to writable temporary storage before querying, while all document, source, external, and graph requests stay on immutable files.
