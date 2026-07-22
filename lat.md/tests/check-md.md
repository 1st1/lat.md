---
lat:
  require-code-mention: true
---

# Check MD

Tests for validating wiki links in `lat.md/` markdown files.

## Detects broken links

Given a file with a wiki link pointing to a nonexistent section, [[cli#check#md]] should report it as a broken link.

## Passes with valid links

Given files where all wiki links resolve to existing sections, [[cli#check#md]] should report no errors.

### Passes with Java symbol links

Given `lat.md` links to Java classes, methods, constructors, fields, nested classes (standalone and `Outer#Inner`-qualified), interfaces, enums, records, and annotation types, [[cli#check#md]] should resolve them all as valid source symbols.

### Passes with C enum value links

Given `lat.md` links to C enum members, including anonymous enums and `typedef enum` members, [[cli#check#md]] should resolve those values as valid source symbols.

### Passes with C struct field links

Given `lat.md` links to C struct fields using `[[file.h#Struct#field]]` syntax, [[cli#check#md]] should resolve those fields as valid source symbols. Covers pointer fields, plain fields, and fields in typedef'd structs.
