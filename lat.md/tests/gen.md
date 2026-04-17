---
lat:
  require-code-mention: true
---

# Gen

Regression tests for built-in template generation. These tests keep shipped agent templates aligned with the current runtime contracts.

Tests in `tests/gen.test.ts`.

## OpenCode plugin template exposes get-source tool

The generated OpenCode plugin includes a `lat_get_source` tool that shells out to `lat get-source`, keeping external-source lookup available in generated agent integrations.

## Skill template teaches external source lookup

The generated skill template teaches agents to resolve external source handles with `lat_get_source`, including prompts phrased like `read <handle> for <stuff>`.
