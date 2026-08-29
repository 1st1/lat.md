---
lat:
  require-code-mention: true
---

# Init

Tests run non-interactive database flows through the built CLI in child processes; TTY-only menu branches use isolated mocks.

## Embedding setup

Initialization makes semantic search local-first while preserving deliberate choices on later re-runs.

### Fresh init pins local embeddings

A fresh or outdated non-interactive init records the repository's local embedding preference before agent selection, even when a key exists and no agent is selected.

The no-agent path also stamps the current init version so later runs preserve the choice.

### Outdated re-run keeps a working hosted index

An outdated init leaves a repository whose hosted index still has a provider/model-compatible key on its existing backend, because the local-first default re-fires on every version bump and must not repeatedly undo a deliberate choice.

### Outdated hosted provider mismatch defaults local

An outdated non-interactive init treats a hosted key for a different provider as incompatible with the stored model, applies the local-first default, and prints the local reindex command.

### Configured key asks for a backend

When an embedding key is available in an interactive fresh init, init asks whether the repository should remain local or explicitly use hosted embeddings, with local selected by default.

### Backend mismatch offers reindexing

When the selected backend differs from the database's recorded embedding model, interactive init offers to rebuild immediately through the existing reindex command.

### Hosted provider mismatch offers reindexing

A current non-interactive init detects when the configured hosted provider/model differs from the hosted index and prints `lat reindex --remote` instead of treating all hosted backends as interchangeable.

### Current setup preserves explicit backend choice

Re-running the current init version does not replace a backend choice the user may have made after initial setup.

### Hosted re-run defaults to hosted

An interactive re-run with a configured key defaults its backend menu to hosted when the stored index is hosted, so Enter preserves the choice instead of rebuilding.

### Non-interactive re-run does not choose

A current-version non-interactive init with a configured key neither displays a fake choice nor changes the repository's existing backend preference.

### Non-interactive mismatch prints command

A non-interactive init with a configured backend that differs from the stored index prints the exact reindex command without starting an expensive rebuild.

## Generated instructions

Generated agent guidance must remain valid Markdown wherever project layouts expose it to Lat's graph scanner.

### Templates satisfy graph validation

Every generated Markdown instruction template passes local graph validation, preventing setup-owned content from breaking `lat check` when an instruction file is symlinked into `lat.md/`.
