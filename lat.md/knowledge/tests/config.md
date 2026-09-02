---
lat:
  require-code-mention: true
---

# Configuration

Tests in `tests/config.test.ts` verify durable user-level configuration behavior in an isolated XDG directory.

## Repository preferences

Repository embedding choices coexist with manually configured hosted keys.

### Persists local preference

Writing and reading a local repository preference round-trips its absolute path without replacing the manual `llm_key` field.
