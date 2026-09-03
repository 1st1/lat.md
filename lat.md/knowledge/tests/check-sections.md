---
lat:
  require-code-mention: true
---
# Check Sections

Validates that every section in `lat.md/` has a well-formed leading paragraph.

## Detects missing leading paragraph

Given a file where a section heading is immediately followed by another heading (no paragraph in between), `checkSections` reports an error for each section that lacks a leading paragraph.

The error message explains the purpose of the overview requirement.

## Detects overly long leading paragraph

Given a section whose first paragraph exceeds 250 characters (after excluding `[[wiki link]]` content), `checkSections` reports an error with the actual character count and the maximum allowed.

## Excludes wiki link content from character count

Given a section whose first paragraph appears long due to `[[wiki links]]` but is within the 250-character limit when link content is excluded, `checkSections` does not report an error.
