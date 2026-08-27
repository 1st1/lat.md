# Website

Standalone Next.js app in `website/`. Deployed to Vercel at `lat.md`.

The app keeps its own package and TypeScript configuration but belongs to the root pnpm workspace so its build can compile Lat and export the vault. It is never included in the npm package's `dist`.

## Current State

Black page with centered vector logo (`website/public/logo.svg`) generated from Menlo font glyphs. Scales to match content width.

Includes a "What's New" changelog showing only the 7 most recent versions. Text-brightness gradient fades older entries darker. When adding a new version, drop the oldest entry to keep the count at 7.

The website build exports this repository's vault as a static Lat UI mounted at `/lat.md/`. A `lat's lat` footer link opens it, and clean document, code, and graph URLs resolve through Next.js rewrites.

The Vercel project must include source files outside the `website/` root because the exporter reads the repository vault and linked source code during the build.
