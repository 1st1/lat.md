---
lat:
  require-code-mention: true
---

# Check Links

Tests for validating ordinary markdown links to local files in `lat.md/` files.

## Detects broken relative links

Given links whose targets do not exist on disk, [[cli#check#links]] should report one error per broken destination, at the line it was written on.

## Names the resolved file and the link kind

Given an anchored link, [[cli#check#links]] should name the file it resolved to, without the anchor; given a broken image, it should say image rather than link.

## Passes valid and skipped link forms

Given links that resolve — including one leaving the graph directory and one resolved against a nested file's own directory — and destinations that are not local paths, [[cli#check#links]] should report no errors.
