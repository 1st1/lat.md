---
lat:
  require-code-mention: true
---

# Check MD

Tests for validating wiki links in `lat.md/` markdown files.

## Detects broken links

Given a file with a wiki link pointing to a nonexistent section, [[cli#check#md]] should report it as a broken link.

### Rejects invalid repository path links

Repository path links fail clearly when the target is missing, escapes the project root, names a non-file/non-directory, or adds a fragment to a directory or unsupported file format.

## Passes with valid links

Given files where all wiki links resolve to existing sections, [[cli#check#md]] should report no errors.

### Accepts repository path links

Wiki links without fragments accept existing project-root-relative regular files and directories, including unsupported or absent extensions, while supported source symbols still resolve normally.

### Passes with C enum value links

Given `lat.md` links to C enum members, including anonymous enums and `typedef enum` members, [[cli#check#md]] should resolve those values as valid source symbols.

### Passes with C struct field links

Given `lat.md` links to C struct fields using `[[file.h#Struct#field]]` syntax, [[cli#check#md]] should resolve those fields as valid source symbols. Covers pointer fields, plain fields, and fields in typedef'd structs.

### Passes with Dart source symbol links

Given links to Dart declarations and nested members, [[cli#check#md]] resolves functions, classes, constructors, fields, mixins, extensions, enums, extension types, aliases, accessors, and operators with complete source ranges.

### Accepts Dart dot shorthand

The bundled Dart grammar parses Dart 3.7 dot shorthand such as `.red` without syntax errors while Lat resolves the containing definitions normally.

### Passes with Java source symbol links

Given links to Java types and members, [[cli#check#md]] resolves classes, interfaces, enums, records, annotation types, nested types, fields, constants, methods, record components, and ordinary or compact constructors with complete source ranges.
