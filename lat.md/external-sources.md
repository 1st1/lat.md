# External Sources

External sources let Lat resolve pinned files and fragments from other Git repositories without making those repositories part of the local project.

The feature treats an external source as a stable handle, canonical repository and commit, optional repository prefix, and retrieval strategy. Authored links remain stable when a local override or canonical commit changes.

## Link Syntax

External links extend the existing wiki-link target with a configured handle followed by `:` and a file path relative to the source's repository prefix.

```text
[[<handle>:<relative-path>]]
[[<handle>:<relative-path>#<fragment>]]
[[<handle>:<relative-path>#<fragment>|<alias>]]
```

Examples include document headings and code symbols:

```md
[[next-docs:app/routing.md]]
[[next-docs:app/routing.md#Navigation]]
[[next-docs:app/routing.md#Navigation|routing documentation]]
[[react-source:packages/react/src/ReactClient.js#createElement]]
```

The same syntax is valid in code mentions:

```ts
// @lat: [[next-docs:app/routing.md#Navigation]]
export function createRouter() {
  // ...
}
```

### Resolution Rules

External reference identity is the authored handle, relative path, and fragment; it never includes the selected commit or local checkout.

- The prefix before the first `:` must match a configured external source handle.
- A relative file path after `:` is required.
- Authored external paths use `/` on every operating system; Windows-style backslashes, drive-qualified paths, UNC paths, absolute paths, and traversal segments are rejected.
- The configured source `prefix` is prepended before repository access.
- `|alias` retains the existing wiki-link alias behavior.
- Fragments may address Markdown headings or symbols supported by Lat's source parser. Numeric line and line-range fragments are rejected.
- Backlinks remain stable when canonical or local configuration changes.

This follows Lat's cross-platform convention that stored paths are POSIX ([[dev-process#Testing#Continuous Integration]]) and uses the same portable separator as [[markdown#Relative Links]]. Windows is supported as a runtime platform, but link syntax is never platform-specific.

Existing acceptance of backslashes in legacy internal wiki links and code references is compatibility behavior and is not extended to the new external syntax.

`local-path` is different: it is machine-local filesystem configuration, so Lat expands `~`, resolves relative values from the project root with native platform path rules, and then appends the portable repository path.

Given `prefix: docs`, this link:

```md
[[next-docs:app/routing.md#Navigation]]
```

resolves inside the repository as:

```text
docs/app/routing.md#Navigation
```

### Parser Integration

The wiki-link tokenizer remains unchanged because its node already preserves an opaque target and optional alias.

Resolution recognizes a configured `<handle>:` prefix before attempting local section or source resolution. It returns a typed external target containing the handle, relative path, fragment, and alias; unknown handles receive a direct diagnostic with suggestions.

## Canonical Configuration

Canonical source definitions live in the root `lat.md/lat.md` frontmatter so every checkout shares the same repository identity, immutable commit, scope, and retrieval strategy.

```yaml
---
lat:
  external-sources:
    next-docs:
      repo: https://github.com/vercel/next.js.git
      commit: 7a21f0d...
      prefix: docs
      strategy: fetch
---
```

The supported fields are:

- `repo` — required canonical HTTPS Git repository URL.
- `commit` — required immutable full commit SHA.
- `prefix` — optional `/`-separated POSIX directory prepended to every authored external path; Windows path syntax is not accepted.
- `strategy` — required retrieval strategy, either `fetch` or `checkout`.
- `fetch-url` — optional raw-file HTTP URL template for the `fetch` strategy.

With `strategy: fetch`, GitHub and GitLab repositories may omit `fetch-url` because Lat infers their raw-file template. Other hosts must provide it, and an explicit value always overrides inference.

With `strategy: checkout`, `fetch-url` is forbidden and Lat uses its managed Git provider. No separate human-facing browse URL is configured; Lat renders retrieved external content inside its own interfaces.

### Repository URLs

Repository identity uses a normalized, credential-free HTTPS URL so configuration cannot select local files, SSH commands, or Git remote helpers.

`repo` must be an absolute `https://` URL with a hostname and repository path. Usernames, passwords, query strings, fragments, SCP-like syntax, and every non-HTTPS scheme or extended Git transport are rejected.

Normalization lowercases the scheme and hostname, removes the default port and trailing slash, and preserves path case. For recognized GitHub and GitLab URLs, one optional terminal `.git` suffix is also removed.

Git network subprocesses disable ambient URL rewriting, credential prompts, unsafe remote helpers, and every protocol except HTTPS. A Lat-managed checkout may use its own verified `origin`; system and global Git configuration are ignored.

### Source Names

An external source name is a stable, filesystem-safe handle shared by configuration, links, commands, and cache paths.

Names must match `^[a-z0-9][a-z0-9_-]*$`: a lowercase ASCII letter or number first, followed by any number of lowercase ASCII letters, numbers, hyphens, or underscores. Names must be unique.

Uppercase letters, whitespace, dots, slashes, backslashes, colons, non-ASCII letters, empty names, and names beginning with punctuation are rejected. Lowercase-only names cannot collide on case-insensitive filesystems.

### Fetch URL Resolution

Every fetched source has one effective raw-file URL template, whether it was configured explicitly or inferred from a recognized repository host.

Lat derives that template in this order:

1. Use the explicit `fetch-url` when present.
2. Otherwise infer the standard raw-file URL for a GitHub or GitLab `repo`.
3. Otherwise reject the source because Lat cannot infer how that host exposes raw files.

Inference recognizes only normalized repositories on the exact hosts `github.com` and `gitlab.com`. GitHub paths must contain exactly `<owner>/<repository>`; GitLab paths contain one or more namespace segments followed by the repository.

GitHub infers `https://raw.githubusercontent.com/<owner>/<repository>/{commit}/{path}`. GitLab infers `https://gitlab.com/<namespace>/<repository>/-/raw/{commit}/{path}`, preserving nested namespace segments.

Explicit and inferred templates use the same validation. A template must be an absolute, credential-free HTTPS URL, contain `{commit}` and `{path}` at least once each, contain no other placeholders or malformed braces, and resolve to source bytes rather than a repository-hosting HTML page.

The `{path}` placeholder is not a configuration field: it expands to the complete repository path formed by joining `prefix` with the authored external link path.

Lat validates URL syntax after replacing the two placeholders with safe sentinel values. At retrieval time it substitutes the effective commit and URL-encodes the resolved repository path per segment; fragments are resolved only after the complete file is fetched.

Redirects are bounded and every redirect target must independently satisfy the HTTPS and credential-free URL rules.

## Local Overrides

Machine-specific source selections live in the gitignored `lat.md/config.local.yaml` file without a redundant top-level `lat` key.

```yaml
external-sources:
  next-docs:
    local-path: ~/src/next.js
    commit: 91bc2d4...
```

Only two override fields are allowed:

- `local-path` — optional path to the local repository checkout root.
- `commit` — optional machine-local commit override.

### Merge Semantics

Local configuration changes where or at which commit a canonical source is read without changing its repository identity or prefix.

The effective commit is the local `commit` when present and otherwise the canonical `commit`. A `local-path` without a local commit must match the canonical commit; when both are present, the checkout must match the local commit.

When `local-path` selects a valid checkout, the effective retrieval strategy is internally `local`. This value is cache metadata, not a permitted canonical `strategy`; canonical configuration still accepts only `fetch` or `checkout`.

Local overrides intentionally make resolution and validation machine-specific. Users managing coordinated local checkouts are responsible for their selected commit; environments without `config.local.yaml`, including ordinary CI, use canonical configuration.

`repo`, `prefix`, `strategy`, and `fetch-url` cannot be overridden locally. Unknown handles and unsupported keys are configuration errors.

### Initialization

`lat init` keeps local overrides out of version control using the existing idempotent Git-ignore management.

Every setup run ensures that `lat.md/.gitignore` contains:

```gitignore
config.local.yaml
```

Index validation permits this one machine-local YAML file in the otherwise Markdown-only directory.

## Command Surface

External source management is grouped beneath `lat external`; the feature does not add a separate top-level `get-source` command.

```text
lat external add [handle] [repo]
lat external show <handle-or-external-ref>
lat external list
```

### Add

`lat external add` resolves a repository reference, lets the user choose retrieval strategy, and writes an immutable canonical definition.

Interactive mode prompts for the handle, repository, commit or mutable ref, optional repository prefix, retrieval strategy, and final confirmation. Mutable refs are resolved remotely, but only the resulting full commit SHA is stored.

A lightweight tag points directly to a commit. An annotated or signed tag points to a separate tag object, so Lat peels it to the underlying commit and stores that commit's SHA; it never stores a tag-object SHA. A ref that does not resolve to a commit is rejected.

For GitHub and GitLab repositories, Lat recommends fetching individual files and permits the inferred template to remain implicit. Unknown hosts recommend checkout and prompt for a custom `fetch-url` when the user selects fetching.

```text
How should Lat read this source?

❯ Fetch individual files from GitHub (recommended)
  Use a Lat-managed checkout
```

Non-interactive callers select the strategy explicitly:

```bash
lat external add next-docs https://github.com/vercel/next.js.git \
  --commit canary \
  --prefix docs \
  --strategy fetch
```

```bash
lat external add kernel-docs https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git \
  --commit master \
  --prefix Documentation \
  --strategy checkout
```

Custom HTTP sources provide their template explicitly:

```bash
lat external add custom-docs https://example.com/project.git \
  --commit release \
  --strategy fetch \
  --fetch-url 'https://example.com/raw/{commit}/{path}'
```

Existing handles are never silently replaced.

### Show and List

`lat external show` renders one source, while `lat external list` applies the identical renderer to every configured source.

The output includes repository, canonical and effective commits, prefix, strategy, effective inferred or explicit fetch URL, local checkout status, target path, cache status, and safe checkout suggestions for agents needing a working tree.

Both commands are strictly observational: they validate configuration and read cache metadata when present, but never reconcile, invalidate, create, delete, or retrieve cache content. A JSON form exposes the same structured data and suggested Git argument arrays.

## Retrieval Providers

External content is retrieved lazily through one provider selected from effective canonical and local configuration.

Provider precedence is:

1. A valid local checkout.
2. Raw HTTP when `strategy` is `fetch`.
3. Lat-managed Git when `strategy` is `checkout`.

A stale or invalid local checkout produces a diagnostic and falls back to the configured canonical strategy; Lat never silently changes strategies.

### Local Checkout

The local provider reads working-tree content beneath the configured repository prefix after validating repository and commit identity.

It expands `~`, requires a Git checkout whose `HEAD` matches the effective commit, and rejects escaping paths or symlinks. Dirty files may be rendered because choosing a local checkout is an explicit machine-local override.

### Raw HTTP

The HTTP provider retrieves and caches one complete source file at a time through the effective inferred or explicit `fetch-url`, then resolves the requested fragment locally.

It accepts only HTTPS, substitutes the effective commit and normalized repository path, follows at most five validated redirects, and limits each read to 5 MiB and 15 seconds. Failures report the source handle, path, URL, and status.

### Managed Checkout

The checkout provider maintains partial Git storage for Lat rather than a full user-facing working tree.

It fetches the pinned commit with blob filtering and reads referenced files from `<commit>:<path>`, downloading blobs lazily through the checkout's verified Lat-owned `origin`. Every Git subprocess uses an argument array and never invokes a shell.

Agents that need an editable checkout use the suggested sparse-clone commands rendered by `lat external show`; Lat never executes those suggestions.

## Cache and Invalidation

External content is cached per source below `lat.md/.cache/external/` so a commit change can invalidate one source completely without disturbing the others.

### Cache Layout

Each source owns one JSON metadata file and, for `fetch` or `checkout`, one adjacent cache directory derived from its validated name.

```text
lat.md/.cache/external/
├── next-docs/
│   └── docs/app/routing.md
└── next-docs.json
```

The directory has one strategy-specific layout. With `fetch`, it is a sparse file tree containing individually retrieved files at their complete repository-relative paths after applying `prefix`. With `checkout`, it is the Lat-managed Git repository itself. With `local`, the directory must not exist because content comes directly from `local-path`.

The `.json` suffix cannot collide with a source directory because dots are forbidden in source names. The internal metadata records the effective commit and the directory's strategy-specific format:

```json
{
  "repo": "https://github.com/vercel/next.js",
  "commit": "7a21f0d...",
  "strategy": "fetch"
}
```

The metadata `strategy` is `fetch`, `checkout`, or the internal value `local`. `repo` is the normalized canonical repository URL, and `commit` is always the effective commit, including a local commit override.

### Cache Invalidation

The normalized repository, effective commit, and strategy define a source's cache generation, while removing the canonical source removes ownership of its cache entirely.

Before resolving an external link, Lat reads `<source>.json` and compares its repository, full commit SHA, and `fetch`, `checkout`, or `local` strategy with effective configuration. Missing, malformed, or mismatched metadata makes the previous generation stale.

For managed checkouts, Lat also verifies that the repository's recorded `origin` normalizes to the metadata repository. A mismatch invalidates the entire generation instead of trusting edited Git configuration.

Lat then deletes only `lat.md/.cache/external/<source>/`. For `fetch` or `checkout` it initializes a fresh directory for the selected provider; for `local` it leaves the directory absent. It atomically replaces the metadata file after transition. Invalidation and initialization are serialized per source.

Serialization combines an in-process queue with a transient per-source filesystem lock, so concurrent commands and server requests cannot publish competing generations or duplicate a cache miss.

Every resolution also enforces the `local` invariant: if metadata says `local` but the sibling directory exists, Lat deletes that directory before reading the configured checkout. Fetched files are written atomically.

Because cache entries use complete repository-relative paths, changing `prefix` changes the lookup path rather than reusing bytes fetched for a different path. Lat does not automatically evict files made unreachable within an otherwise active source.

After successfully loading and validating canonical configuration, Lat compares configured source names with the cache entries it owns. For each removed source, it deletes both `lat.md/.cache/external/<source>/` and `<source>.json` under that source's invalidation lock.

A malformed or invalid configuration never acts like an empty source list: cleanup runs only from a valid configuration snapshot. In-flight retrievals check that snapshot before publishing, so a removed source cannot recreate its cache after deletion.

Changing effective strategy always creates a new cache generation even when the commit is unchanged. A fetched file tree, a managed Git repository, and direct local access have incompatible storage requirements. Changing `fetch-url` without changing the commit retains the fetched generation because the URL must serve the file selected by that commit.

### Configuration Reloading

Every consumer observes canonical and local configuration changes without retaining stale module-global state.

Short-lived external-aware commands other than `lat external show` and `lat external list` reload both files and reconcile caches on every invocation, while MCP does so on every content-resolving tool call. `lat ui` watches configuration and referenced files so changes publish a new atomic resolver snapshot and trigger reconciliation.

Concurrent retrievals share in-flight work, and successful cache writes become visible atomically.

### Automatic Synchronization

External-aware commands share one synchronization path that reconciles valid configuration, cache generations, and the exact external files required by the operation.

`lat check` scans Markdown links and `@lat:` mentions, groups external targets by complete repository-relative file path, invalidates changed or removed sources, and materializes every referenced file through its selected provider. Multiple fragments in one file cause one retrieval.

After a commit change, this repopulates the fresh source cache from the project's current reference set. Adding a link to a previously unseen file fetches that file on the next check. Retrieval failures and missing files or named fragments are validation errors.

Other content-resolving commands run the same configuration and generation reconciliation before doing external work, then retrieve cache misses needed for their output. `lat refs` reconciles state but scans only local backlinks; `lat external show` and `list` never touch cache state.

When a changed generation cannot be materialized, the command fails with its provider diagnostic. Lat neither restores the invalidated generation nor serves stale content; the user must correct configuration or restore network access and retry.

`lat ui` reruns synchronization when its watched reference set or external configuration changes. It retrieves newly referenced files and refreshes affected views while surfacing provider failures as file errors.

## Command Integration

Existing commands use one shared external resolver and provider layer rather than duplicating retrieval or formatting logic.

### Validation

`lat check` validates configuration, handles, safe paths, local checkout commits, referenced files, and named Markdown-heading or source-symbol fragments.

External targets in both Markdown and `@lat:` comments participate. The check synchronizes every uniquely referenced external file before validating its named fragments; an invalid local checkout remains an error even when canonical fallback succeeds.

### Section and Expand

`lat section` renders an exact external target, while `lat expand` adds requested external content to agent context.

Named Markdown sections, source symbols, and complete supported files are accepted. Local section output includes external-reference metadata and snippets.

### References

`lat refs` accepts an exact external target and finds local Markdown and code backlinks without scanning the external repository.

```bash
lat refs 'next-docs:app/routing.md#Navigation'
```

### Search

External content does not participate in semantic search or reindexing.

## MCP and Agent Integration

Agents receive the same read-only source inspection and resolution behavior as CLI users through shared command functions.

The read-only `lat_external_list` and `lat_external_show` tools expose configured source metadata. Existing section, expand, refs, and check tools resolve external content through the shared provider layer; the mutating add flow is not exposed through MCP.

Generated agent guidance teaches agents to inspect a source before cloning:

```bash
lat external show <handle>
```

## Browser Integration

External links open internal Lat previews with the same context, highlighting, references, and navigation behavior as local source links.

Browser routes use `/external/<handle>/<path>#<fragment>` and the loopback API accepts only targets recognized by current validated configuration.

### Live UI

The loopback server retrieves remote files so browsers never require cross-origin access.

Markdown and supported code receive their existing renderers. Configuration and referenced local-file changes refresh active previews without restarting the server or discarding navigation state.

### Static Export

Static builds resolve every externally referenced canonical file during generation and bundle each unique file once.

The exported site makes no live requests, includes no Git object store, and preserves external previews, fragments, backlinks, and graph nodes. Local `commit` and `local-path` overrides are ignored so builds remain portable and reproducible.

Source payloads are split from per-symbol view metadata, allowing multiple referenced symbols in one external file to share one serialized source body and highlighted-line array.

## Validation and Security

External input crosses network and filesystem boundaries, so validation occurs before any file, URL, Git, or renderer access.

- Stored commits must be immutable full SHAs.
- Handles must match `^[a-z0-9][a-z0-9_-]*$`; paths, strategies, templates, and local override keys are also validated.
- Repository URLs must use credential-free HTTPS without queries, fragments, URL rewriting, remote helpers, or extended transports.
- Explicit and inferred `fetch-url` templates must be credential-free HTTPS URLs containing `{commit}` and `{path}` at least once each, with no unknown placeholders or malformed braces.
- `strategy: checkout` forbids `fetch-url`; `strategy: fetch` requires either a recognized GitHub/GitLab repository or an explicit template.
- Response size and timeout limits bound remote reads.
- Downloaded content is treated as untrusted and escaped by renderers.
- Filesystem access remains beneath the configured checkout and repository prefix.
- Suggested shell commands are never executed.
- Git always runs with argument arrays.
- Cache writes are atomic and stored paths are normalized to POSIX form.
- UI APIs expose only configured external targets.

## Design Boundaries

External sources are pinned, read-only, and retrieved on demand so resolution stays reproducible and bounded.

### Immutable Revisions

Canonical and local configuration selects a full commit SHA rather than tracking a mutable branch or tag.

`lat external add` may accept a mutable ref for convenience, but it resolves and stores the current immutable commit. Updating an external source is an explicit configuration change.

### Read-only Access

Lat reads and renders external content without modifying external repositories or local checkouts.

Agents may use the checkout suggestions from `lat external show` when they need an editable working tree, but Lat never runs those commands or writes through an external reference.

### On-demand Retrieval

Lat retrieves exact files reached through configured external references rather than crawling or mirroring complete repositories.

Fetch providers download referenced files individually. Managed checkouts use partial Git storage and lazy blob retrieval, keeping work proportional to the external content the project actually references.

### Stable Fragments

External fragments identify Markdown headings and supported code symbols by name rather than by physical line number.

Named targets survive unrelated insertions and deletions. Lat rejects line-number and line-range fragments because they silently drift to different content as an external file evolves.

## Known Limitations

Some useful external-source capabilities remain unsupported without weakening the core pinned, read-only model.

- External content does not participate in semantic indexing or search.
- Only Markdown and languages supported by Lat's source parser can be resolved; reStructuredText, AsciiDoc, binary files, and other formats are rejected.
- Private-source authentication is not supported.
- Cache invalidation handles commit changes and removed sources, but files made unreachable within an active source are not automatically evicted.
