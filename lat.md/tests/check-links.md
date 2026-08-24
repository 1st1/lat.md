---
lat:
  require-code-mention: true
---

# Check Links

Tests for full CLI validation of ordinary markdown links to local files in `lat.md/` files.

## Detects broken relative links

Running `lat check links` with missing local targets or undefined full and collapsed reference-style links reports each error at the authored line.

## Names the resolved file and the link kind

Given an anchored link, [[cli#check#links]] should name the file it resolved to, without the anchor; given a broken image, it should say image rather than link.

## Default check validates relative links

Running `lat check` without a subcommand includes [[cli#check#links]] and fails when an ordinary relative markdown link is broken.

## Passes valid and skipped link forms

Running `lat check links` with resolving paths, skipped non-local destinations, escaped reference syntax, and links inside code reports no errors.
