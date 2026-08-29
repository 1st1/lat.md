---
lat:
  require-code-mention: true
---

# Check Links

Tests for full CLI validation of ordinary markdown links to local files in `lat.md/` files.

## Detects broken relative links

Running `lat check links` with missing local targets or undefined full and collapsed reference-style links reports each error at the authored line.

## Rejects undefined shortcut references

Unescaped shortcut references require definitions; diagnostics tell authors to add one or escape the opening bracket for literal text, and packed same-line definitions cannot silently degrade into prose.

## Names the resolved file and the link kind

Given an anchored link, [[cli#check#links]] should name the file it resolved to, without the anchor; given a broken image, it should say image rather than link.

## Default check validates relative links

Running `lat check` without a subcommand includes [[cli#check#links]] and fails when an ordinary relative markdown link is broken.

## Passes valid and skipped link forms

Running `lat check links` with resolving paths, skipped non-local destinations, escaped reference syntax, and links inside code reports no errors.

## Accepts GitHub heading fragments

Running `lat check links` accepts GitHub fragments with punctuation removed and duplicate headings suffixed in document order.

## Rejects non-GitHub heading fragments

For ordinary Markdown links, `lat check links` rejects heading fragments that are not GitHub-style slugs. Wiki links are unaffected: they accept both literal Obsidian headings and GitHub slugs.

## Rejects backslash path separators

Regular Markdown links reject literal or percent-encoded backslashes in local
paths and direct authors to use `/`, preventing Windows-only false positives.
