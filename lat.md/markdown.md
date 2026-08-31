# Markdown

Extensions to standard markdown used in `lat.md` files.

## Tables

GitHub-flavored pipe tables are parsed as structured rows and cells, so `lat ui` renders semantic, horizontally scrollable HTML tables instead of pipe-delimited text.

Table syntax is supported by the shared [[parser#Tables|parser extension]], including inline Markdown inside cells.

## Strikethrough

GitHub-flavored single- or double-tilde delimiters render obsolete text with semantic `del` markup while preserving the authored delimiters during serialization.

## Task Lists

GitHub-flavored checked and unchecked list markers render as accessible, read-only checkboxes while remaining ordinary Markdown list structure for parsing and serialization.

## Bare Autolinks

GitHub-flavored bare HTTP(S), `www.`, and email addresses become links without requiring angle brackets or explicit Markdown link syntax.

## Safe HTML

GitHub-compatible HTML elements render through a strict allowlist, enabling constructs such as `details`, `summary`, `sub`, `sup`, and `picture` without allowing scripts or event handlers.

Raw HTML is parsed before sanitization. Unsafe elements, URL protocols, and attributes are removed, while `details` may preserve its boolean `open` state for authored expanded sections.

## Alerts

GitHub alert blockquotes for `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION` render as labeled callouts with distinct semantic colors while retaining ordinary blockquote source syntax.

## Footnotes

GitHub footnote references and definitions render as linked superscripts, a notes section, and return links while retaining their labels and definitions during serialization.

## Emoji Shortcodes

GitHub-style `:name:` emoji shortcodes render as accessible Unicode emoji or GitHub's custom emoji images, while unknown names and source serialization remain unchanged.

## Fenced Code Highlighting

Fenced code blocks use their language label for safe server-side Lowlight trees, with common source, shell, web, data, diff, and Markdown grammars supported and unknown labels retained as plain code.

## Math

GitHub-style inline dollar delimiters, display dollar blocks, and `math` fences render as accessible KaTeX while retaining their authored math syntax during parsing and serialization.

## Mermaid Diagrams

GitHub-style `mermaid` fences render as React-owned SVG trees in the browser through Mermaid's strict security mode, with the escaped source retained as a readable fallback when loading or rendering fails.

## GeoJSON and TopoJSON Maps

GitHub-style `geojson` and `topojson` fences render supplied geometry over an OpenStreetMap basemap from OpenFreeMap, with pan, zoom, and automatic data bounds.

The browser loads the hosted vector style and tiles only when a map fence is present. If that service is unavailable, MapLibre keeps the geometry interactive over a local grid fallback; attribution remains visible whenever OpenFreeMap data is used.

Before first client paint, the source fallback becomes a fixed-height loading shell. Renderer and module-load failures restore escaped source with a retry action; rejected lazy imports are evicted so Retry performs a fresh load.

## ASCII STL Models

GitHub-style `stl` fences parse ASCII STL into responsive, centered, automatically framed 3D models that can be rotated and zoomed in the browser without external services.

## GitHub Surface Boundaries

Lat documents follow GitHub's repository-file Markdown surface. Conversation-only issue, pull-request, commit, mention, color-chip, task-unfurl, custom-autolink, and code-permalink enrichments remain literal text or ordinary URLs.

Those enrichments depend on live GitHub repository, account, permission, or issue metadata and are not part of portable document syntax. GitHub itself does not create issue or pull-request autolinks or code-snippet embeds in repository Markdown files.

## Wiki Links

Obsidian-style links: `[[target]]` or `[[target|alias]]`. Uses `|` as the alias divider.

Targets are section ids — hierarchical paths like `lat.md/dev-process#Testing#Running Tests`. The vault root is the project directory (the parent of `lat.md/`), so all markdown section ids include the `lat.md/` prefix. Wiki links can also reference source code symbols — see [[markdown#Wiki Links#Source Code Links]].

Validated by [[cli#check#md]].

### Resolution Rules

Aligned with Obsidian conventions:

- **`[[foo]]`** or **`[[foo.md]]`** — link to the **file** `foo.md`. Resolves to the root section of that file. Does not search section headings.
- **`[[foo#Bar]]`** or **`[[foo.md#Bar]]`** — heading `Bar` in file `foo.md`. The path after `#` must be an exact heading chain — no intermediate headings can be omitted.
- **`[[path/foo#Bar]]`** — fully qualified: file `path/foo.md`, heading `Bar`.

The `.md` extension is optional in local Markdown links and is removed during resolution. Lat prefers and emits the cleaner extensionless form; both spellings resolve to the same canonical section id. Explicit extensions remain required for source code and other non-Markdown files.

Heading segments accept either their literal Obsidian form (`Some Section!`) or their GitHub slug (`some-section`). Resolution always returns and displays the canonical literal-heading section id, so existing links and CLI output remain unchanged. Literal matches win if the two forms collide.

### Short Path Disambiguation

Short refs are supported for markdown files inside `lat.md/` only. When a file stem is unique across the vault, it can be used without its directory prefix.

For example, `[[setup#Install]]` resolves to `lat.md/guides/setup#Install` if `setup.md` only exists under `lat.md/guides/`.

When multiple files share the same stem (e.g. `alpha/notes.md` and `beta/notes.md`), the short form is ambiguous — [[cli#check#md]] reports an error listing all candidates. If the referenced section exists in only one file, the error suggests the specific fix.

Source code references (e.g. `[[src/config.ts#getConfigDir]]`) always require the full path — no short refs for source files.

Resolution is handled by [[src/lattice-model.ts#resolveRef]]. See [[parser#Short Ref Resolution]] for implementation details.

### Source Code Links

Wiki links can reference symbols in TypeScript, JavaScript, Python, Dart, Rust, Go, and C source files:

- **`[[src/config.ts#getConfigDir]]`** — the `getConfigDir` function in `src/config.ts`
- **`[[src/server.ts#App#listen]]`** — the `listen` method on class `App` in `src/server.ts`
- **`[[lib/service.dart#Greeter#greet]]`** — the `greet` method on class `Greeter` in Dart
- **`[[src/lib.rs#Greeter#greet]]`** — the `greet` method on struct `Greeter` in Rust
- **`[[src/app.go#Greeter#Greet]]`** — the `Greet` method on type `Greeter` in Go
- **`[[src/app.h#Greeter]]`** — the `Greeter` struct in a C header
- **`[[src/app.h#Greeter#prefix]]`** — the `prefix` field of struct `Greeter` in C
- **`[[src/config.ts]]`** — link to the file itself (no symbol)

Supported extensions: `.c`, `.dart`, `.go`, `.h`, `.js`, `.jsx`, `.py`, `.rs`, `.ts`, `.tsx`. The typed [[src/source-formats.ts#SOURCE_FILE_EXTENSIONS]] registry governs source-link parsing, external source validation, and `@lat:` code-mention scanning.

Python symbols: functions, classes, methods, module-level variables. Decorated definitions (`@decorator`) are unwrapped transparently — `[[file.py#my_func]]` resolves whether or not `my_func` has decorators, and `# @lat:` comments placed between decorators and the `def`/`class` line are scanned normally.

Dart symbols: functions, getters, setters, classes, constructors, fields, mixins, named extensions, enums and values, extension types, type aliases, and top-level variables. Nested members use `[[file.dart#Type#member]]`; named constructors use their suffix (`#Type#named`), while unnamed constructors use the class name (`#Type#Type`). Operators retain Dart spelling, such as `[[file.dart#Greeter#operator ==]]`. Annotations are included in definition ranges, and `// @lat:` comments are scanned like other C-style source comments.

Rust symbols: functions, structs, enums, traits, impl methods, consts, statics, type aliases. Methods are resolved via `impl` blocks — `[[file.rs#Type#method]]` matches any `impl Type { fn method() }` or `impl Trait for Type { fn method() }`.

Go symbols: functions, types (structs, interfaces, type aliases), methods (with receiver), consts, vars. Methods are resolved via receiver type — `[[file.go#Type#Method]]` matches `func (t *Type) Method()`.

C symbols: functions (including pointer-returning like `char *func()`), structs, struct fields/members, enums, enum values (including anonymous enums and `typedef enum` members), typedefs, `#define` macros (both object-like and function-like), variables (including arrays). Struct fields are resolved via the parent struct — `[[file.h#Struct#field]]` matches any `field_declaration` inside `struct Struct { ... }`, including fields nested inside anonymous unions and structs. Enum values can be referenced standalone (`[[file.h#GREEN]]`) or qualified by their enum name (`[[file.h#Color#GREEN]]`); both forms work for named enums, `typedef enum`, and named `typedef enum`. Both `.c` and `.h` files are supported — include guards (`#ifndef`/`#endif`) are walked through transparently.

Source code is parsed lazily with tree-sitter (via `web-tree-sitter`). Only files referenced by wiki links are analyzed—there is no up-front scan—and unchanged AST-free symbol tables are reused through [[architecture-analysis#Persistent cache]]. [[cli#check#md]] validates that the file exists and the symbol is defined.

### Strict vs Lenient Contexts

**Strict** — `lat check` and `lat refs` use `resolveRef()` directly. Links must resolve unambiguously to a known section. Ambiguous or broken links are errors.

**Lenient** — `lat locate` and `lat expand` use `findSections()`, which applies tiered matching (exact → file stem → subsection tail → fuzzy). These commands are for interactive exploration and accept approximate queries.

## Relative Links

Ordinary markdown links (`[text](path)`) to local files are validated for existence, so a moved or deleted file is caught the same way a stale `[[wiki link]]` is.

Targets resolve against the containing file's directory. A link that leaves `lat.md/` (`../../AGENTS.md`) is checked like any other. Inline links, images, and reference definitions (`[id]: ./path.md`) all participate; code samples and bracket-like text in raw HTML do not.

Fragments targeting Markdown files must match a GitHub-style heading id. GitHub lowercases headings, removes punctuation, replaces spaces with hyphens, and suffixes duplicate ids with `-1`, `-2`, and so on. Bare fragments target the containing file and are validated the same way.

Full (`[text][id]`), collapsed (`[id][]`), and shortcut (`[id]`) references without a matching definition are errors. Literal bracketed prose must escape its opening bracket (`\[id]`), keeping link intent explicit in Lat's strict Markdown dialect.

Destinations that are not local paths are skipped and never reported:

- **Any URI scheme** — `https:`, `mailto:`, and a Windows absolute path like `C:/notes.md`.
- **Root-absolute and protocol-relative** — `/img/logo.png`, `//example.com/x`. Ambiguous between a site root and the filesystem root.

A `?query` is dropped before resolving. Fragments on non-Markdown targets are ignored because they are not heading ids.

Local paths must use `/` separators on every operating system. Literal and
percent-encoded backslashes are rejected because GitHub treats them as filename
characters rather than Windows path separators. This restriction does not
apply to lat wiki links or code references. Diagnostics display filesystem
paths with `/` separators on every operating system.

Validated by [[cli#check#links]].

## Leading Paragraph

Every section must have a leading paragraph — at least one sentence immediately after the heading, before any child headings.

The first paragraph must be ≤250 characters (excluding `[[wiki link]]` content). It serves as the section's overview for search results, command output, and RAG context. Subsequent paragraphs can go into detail.

Validated by [[cli#check#sections]].

## Frontmatter

`lat.md` files support YAML frontmatter for per-file configuration:

```yaml
---
lat:
  require-code-mention: true
---
```

### require-code-mention

When set to `true`, [[cli#check#code-refs]] ensures every leaf section (sections with no children) in the file has a corresponding `// @lat: [[...]]` reference in source code. Useful for test specs and requirements that must be traceable to implementation.
