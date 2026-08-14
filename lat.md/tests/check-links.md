---
lat:
  require-code-mention: true
---

# Check Links

Tests for validating ordinary markdown links to local files in `lat.md/` files.

## Detects broken relative links

Given links whose targets do not exist on disk, [[cli#check#links]] should report one error per broken target — covering the bare, `./`, `../`, and outside-the-graph forms.

## Reports anchors and images distinctly

Given an anchored link, [[cli#check#links]] should validate only the file part and name it in the error; given a broken image, it should report a broken image rather than a broken link.

## Passes valid and skipped link forms

Given links that resolve — including one leaving the graph directory and one resolved against a nested file's own directory — and destinations that are not local paths, [[cli#check#links]] should report no errors.
