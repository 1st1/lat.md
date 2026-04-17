# Markdown

Extensions to standard markdown used in `lat.md` files.

## Wiki Links

Obsidian-style links: `[[target]]` or `[[target|alias]]`. Uses `|` as the alias divider.

Targets are section ids — hierarchical paths like `lat.md/dev-process#Testing#Running Tests`. The vault root is the project directory (the parent of `lat.md/`), so all markdown section ids include the `lat.md/` prefix. Wiki links can also reference source code symbols — see [[markdown#Wiki Links#Source Code Links]].

Validated by [[cli#check#md]].

### Resolution Rules

Aligned with Obsidian conventions:

- **`[[foo]]`** — link to the **file** `foo.md`. Resolves to the root section of that file. Does not search section headings.
- **`[[foo#Bar]]`** — heading `Bar` in file `foo.md`. The path after `#` must be an exact heading chain — no intermediate headings can be omitted.
- **`[[path/foo#Bar]]`** — fully qualified: file `path/foo.md`, heading `Bar`.

### Short Path Disambiguation

Short refs are supported for markdown files inside `lat.md/` only. When a file stem is unique across the vault, it can be used without its directory prefix.

For example, `[[setup#Install]]` resolves to `lat.md/guides/setup#Install` if `setup.md` only exists under `lat.md/guides/`.

When multiple files share the same stem (e.g. `alpha/notes.md` and `beta/notes.md`), the short form is ambiguous — [[cli#check#md]] reports an error listing all candidates. If the referenced section exists in only one file, the error suggests the specific fix.

Source code references (e.g. `[[src/config.ts#getConfigDir]]`) always require the full path — no short refs for source files.

Resolution is handled by [[src/lattice.ts#resolveRef]]. See [[parser#Short Ref Resolution]] for implementation details.

### Source Code Links

Wiki links can reference symbols in TypeScript, JavaScript, Python, Rust, Go, and C source files:

- **`[[src/config.ts#getConfigDir]]`** — the `getConfigDir` function in `src/config.ts`
- **`[[src/server.ts#App#listen]]`** — the `listen` method on class `App` in `src/server.ts`
- **`[[src/lib.rs#Greeter#greet]]`** — the `greet` method on struct `Greeter` in Rust
- **`[[src/app.go#Greeter#Greet]]`** — the `Greet` method on type `Greeter` in Go
- **`[[src/app.h#Greeter]]`** — the `Greeter` struct in a C header
- **`[[src/app.h#Greeter#prefix]]`** — the `prefix` field of struct `Greeter` in C
- **`[[src/config.ts]]`** — link to the file itself (no symbol)

Supported extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.c`, `.h`.

Python symbols: functions, classes, methods, module-level variables. Decorated definitions (`@decorator`) are unwrapped transparently — `[[file.py#my_func]]` resolves whether or not `my_func` has decorators, and `# @lat:` comments placed between decorators and the `def`/`class` line are scanned normally.

Rust symbols: functions, structs, enums, traits, impl methods, consts, statics, type aliases. Methods are resolved via `impl` blocks — `[[file.rs#Type#method]]` matches any `impl Type { fn method() }` or `impl Trait for Type { fn method() }`.

Go symbols: functions, types (structs, interfaces, type aliases), methods (with receiver), consts, vars. Methods are resolved via receiver type — `[[file.go#Type#Method]]` matches `func (t *Type) Method()`.

C symbols: functions (including pointer-returning like `char *func()`), structs, struct fields/members, enums, enum values (including anonymous enums and `typedef enum` members), typedefs, `#define` macros (both object-like and function-like), variables (including arrays). Struct fields are resolved via the parent struct — `[[file.h#Struct#field]]` matches any `field_declaration` inside `struct Struct { ... }`, including fields nested inside anonymous unions and structs. Enum values can be referenced standalone (`[[file.h#GREEN]]`) or qualified by their enum name (`[[file.h#Color#GREEN]]`); both forms work for named enums, `typedef enum`, and named `typedef enum`. Both `.c` and `.h` files are supported — include guards (`#ifndef`/`#endif`) are walked through transparently.

Source code is parsed lazily with tree-sitter (via `web-tree-sitter`). Only files referenced by wiki links are parsed — no up-front scanning. [[cli#check#md]] validates that the file exists and the symbol is defined.

### External Source Links

Wiki links can reference pinned external repositories through short handles defined in frontmatter.

Use the syntax `[[handle:path/to/file#fragment]]`, for example `[[architecture-docs:docs/system/request-flow.md#L123]]`. The handle is resolved through `lat.external-sources` in `lat.md/lat.md` frontmatter, which defines the canonical repository URL, pinned revision, and browse URL template.

Machine-local overrides live in `lat.md/config.local.json` under the same `lat.external-sources` key path. A local override provides `path`, pointing to a checkout of the same repository at the pinned revision. When present and valid, navigation prefers the local checkout; otherwise it falls back to the canonical `browse` URL.

The same `[[handle:path#fragment]]` form is also valid inside source code `@lat:` comments when implementation or tests need to point directly at an external design document.

For AsciiDoc files (`.adoc`, `.asciidoc`), fragments can target section headings using either autogenerated Asciidoctor ids like `#_extended_attributes` or explicit section ids like `#custom-layout`. When a valid local checkout is configured, lat resolves those heading fragments to local line ranges for display.

Use [[cli#get-source]] or the `lat_get_source` MCP tool when you need the active root location for a handle itself rather than a deep-linked file target.

External links are validated by [[cli#check#md]], and configured handles are also accepted by [[cli#check#code-refs]] when they appear in `@lat:` comments. If a local override is configured, `lat check` also verifies that the checkout exists, is a git repository, and that `HEAD` matches the configured pinned revision.

### Strict vs Lenient Contexts

**Strict** — `lat check` and `lat refs` use `resolveRef()` directly. Links must resolve unambiguously to a known section. Ambiguous or broken links are errors.

**Lenient** — `lat locate` and `lat expand` use `findSections()`, which applies tiered matching (exact → file stem → subsection tail → fuzzy). These commands are for interactive exploration and accept approximate queries.

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

### external-sources

The root `lat.md/lat.md` file can define canonical external source handles for deep-links into pinned external repositories.

```yaml
---
lat:
  external-sources:
    architecture-docs:
      repo: https://example.com/architecture-docs.git
      rev: v6.9
      browse: https://example.com/architecture-docs/tree/{path}?h={rev}#{fragment}
---
```

The supported fields are:

- `repo` — canonical repository identifier
- `rev` — pinned git revision used for validation and browse URLs
- `browse` — URL template with `{path}`, `{rev}`, and `{fragment}` substitutions

Local machine overrides belong in `lat.md/config.local.json`:

```json
{
  "lat": {
    "external-sources": {
      "architecture-docs": {
        "path": "~/src/architecture-docs"
      }
    }
  }
}
```

Only `path` is supported in `config.local.json`. A leading `~/` is expanded to the current user's home directory. This file is meant to stay local and should be gitignored.
