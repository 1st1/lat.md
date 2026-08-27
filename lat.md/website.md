# Website

Standalone Next.js app in `website/`. Deployed to Vercel at `lat.md`.

The app belongs to the root pnpm workspace but is never included in the npm package's `dist`.

Its wiki prebuild compiles the current Lat CLI and UI source while resolving the embedding engine and model from pinned npm releases. Vercel therefore avoids the workspace Rust, WASM, and model builds.

## Current State

Black page with centered vector logo (`website/public/logo.svg`) generated from Menlo font glyphs. Scales to match content width.

Includes a "What's New" changelog showing only the 7 most recent versions. Text-brightness gradient fades older entries darker. When adding a new version, drop the oldest entry to keep the count at 7.

The website build exports this repository's vault as a static Lat UI mounted at `/lat.md/`. A `lat's lat` footer link opens it, and clean document, code, and graph URLs resolve through Next.js rewrites.

The Vercel project must include source files outside the `website/` root because the exporter reads the repository vault and linked source code during the build.
