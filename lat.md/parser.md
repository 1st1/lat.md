# Parser

Markdown parsing built on unified/remark v11. Entry point: [[src/parser.ts]]. Parse → render fidelity is verified by [[tests/roundtrip]].

## Tables

The shared AST recognizes [[markdown#Tables|GitHub-flavored pipe tables]] through the table-only micromark and mdast extensions, preserving table structure for rendering and serialization without enabling unrelated GFM syntax.

## Strikethrough

The shared AST recognizes [[markdown#Strikethrough|GitHub-flavored strikethrough]] with its focused micromark and mdast extensions, including GitHub's single-tilde form.

## Task Lists

The shared AST records [[markdown#Task Lists|GitHub task markers]] on list items through focused micromark and mdast extensions so rendering can emit semantic checkbox controls.

## Bare Autolinks

The shared AST recognizes [[markdown#Bare Autolinks|GitHub bare autolinks]] through focused micromark and mdast extensions, retaining their authored literal form during serialization.

## Safe HTML

CommonMark preserves authored HTML nodes for exact serialization; `lat ui` reparses them into HAST and applies the [[markdown#Safe HTML|GitHub-compatible sanitization boundary]] before stringifying.

## Wiki Links

Custom micromark + mdast extension implementing [[markdown#Wiki Links]]. Located in `src/extensions/wiki-link/` (see [[src/extensions/wiki-link/syntax.ts]] for the tokenizer).

Built in-house because third-party packages (`mdast-util-wiki-link`, `@portaljs/remark-wiki-link`) are broken with remark v11 / mdast-util-from-markdown v2.

### Wiki Link Node

A `wikiLink` node has `value` (the target string) and `data.alias` (string or null). Registered into mdast's `RootContentMap`, `PhrasingContentMap`, micromark's `TokenTypeMap`, and mdast-util-to-markdown's `ConstructNameMap` via module augmentation.

## Sections

A section is a heading plus everything under it until the next same-or-higher-depth heading. Parsed by [[src/lattice.ts#parseSections]].

Each section has:
- `id` — hierarchical path: `file#H1#H2#...` where the first segment is the project-root-relative file path (without `.md`) and every heading level is included: `lat.md/dev-process#Dev Process#Testing#Running Tests`, `lat.md/tests/search#Search Tests#RAG Replay Tests`
- `heading` — the heading text
- `depth` — markdown heading level (1–6)
- `file` — project-root-relative file path without `.md` (e.g. `lat.md/dev-process`, `lat.md/tests/search`)
- `filePath` — project-root-relative file path with extension (e.g. `lat.md/dev-process.md`, `src/config.ts`)
- `children` — nested subsections forming a tree
- `startLine` / `endLine` — source positions in the original file
- `firstParagraph` — first paragraph text (used by [[cli#Section Preview]])
- `githubSlug` — GitHub-compatible heading id, including duplicate suffixes within the document

[[markdown#Frontmatter]] is handled by `remark-frontmatter`, which parses it as a `yaml` AST node so heading positions reflect the original file.

## Short Ref Resolution

References can use just the file name (without directory path) when the name is unique across the vault. Short refs only work for markdown files in `lat.md/`; source code references always require the full path.

For example, `[[search#Provider Detection]]` resolves to `lat.md/tests/search#Search Tests#Provider Detection` if there's only one `search.md` in the vault. If multiple files share the same name, the full path is required — `lat check` reports ambiguous refs as errors.

The root (h1) heading can be omitted in references: `[[backend#CORS]]` resolves to `lat.md/backend#Backend#CORS` because the h1 heading is implicit from the file. Both `resolveRef()` and `findSections()` handle this by trying to insert root headings when a direct match fails.

[[src/lattice.ts#buildSectionSlugIndex]] maps GitHub-slugged heading paths back to canonical literal-heading ids. Strict and lenient resolution accept either form while continuing to return the original section ids used by existing CLI output.

The file index ([[src/lattice.ts#buildFileIndex]]) maps all trailing path suffixes to their full paths. For `lat.md/guides/setup`, both `guides/setup` and `setup` are indexed. All keys are lowercase for case-insensitive lookup.

Stored paths are always forward-slash (POSIX), independent of host OS. Node's `path.relative()` emits the native separator (`\` on Windows), so every OS-relative path is normalized through [[src/walk.ts#toPosix]] at construction — in [[src/lattice.ts#parseSections]], [[src/lattice.ts#extractRefs]], and the code-ref scanner ([[src/code-refs.ts#scanCodeRefs]]). Reference resolution also accepts Windows-style backslashes in the file portion and normalizes them before matching, preserving refs generated before this invariant was introduced. Without this, `buildFileIndex` (which splits on `/`) failed to index any suffix on Windows, so bare-name links in directory-index files never resolved (issue #69).

Resolution is handled by [[src/lattice.ts#resolveRef]] for strict contexts (`lat check`, `lat refs`) where authored links must resolve unambiguously. Lenient contexts (`lat locate`, `lat expand`) use [[src/lattice.ts#findSections]] directly, which has its own file stem expansion built in — it does not call `resolveRef`.

## Refs Extraction

[[src/lattice.ts#extractRefs]] walks the AST for [[parser#Wiki Links#Wiki Link Node]] nodes and returns the target, enclosing section id, file, and line number.
