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

### Strict vs Lenient Contexts

**Strict** — `lat check` and `lat refs` use `resolveRef()` directly. Links must resolve unambiguously to a known section. Ambiguous or broken links are errors.

**Lenient** — `lat locate` and `lat expand` use `findSections()`, which applies tiered matching (exact → file stem → subsection tail → fuzzy). These commands are for interactive exploration and accept approximate queries.

## Relative Links

Ordinary markdown links (`[text](path)`) to local files are validated for existence, so a moved or deleted file is caught the same way a stale `[[wiki link]]` is.

Targets resolve against the containing file's directory — the rule every markdown renderer applies — and existence on disk is the only test. A link pointing outside `lat.md/` (`../../AGENTS.md`) is therefore checked too. Inline links, images, and reference definitions (`[id]: ./path.md`) all participate. Because validation walks the mdast rather than matching text, a link inside a fenced or inline code block is correctly ignored.

These destinations are never treated as paths, and never reported:

- **Any URI scheme** — `https:`, `mailto:`, `tel:`, custom app schemes. A Windows absolute path (`C:/notes.md`) matches this rule and is skipped rather than misread as a relative path.
- **Root-absolute** — `/img/logo.png`, and protocol-relative `//example.com/x`. Ambiguous between a site root and the filesystem root, so checking either way would invent false positives.
- **Pure fragments** — `#section`, an anchor within the same file.

A `?query` and `#fragment` are dropped before resolving, so `foo.md#some-heading` verifies that `foo.md` exists and `?tab=1` alone is skipped. The anchor itself is not validated — matching a heading to its slug depends on the target renderer's own anchor rules.

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
