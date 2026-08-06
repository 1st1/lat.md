---
lat:
  require-code-mention: true
---

# Gen

Regression tests for built-in template generation. These tests keep shipped agent templates aligned with the current runtime contracts.

Tests in `tests/gen.test.ts`.

## OpenCode plugin template uses event hook

The generated OpenCode plugin listens for `session.idle` through the plugin `event` callback so it matches the current OpenCode plugin API instead of relying on an older hook shape.

## OpenCode plugin template pipes child process output

The generated OpenCode plugin runs `lat` and `git` child processes with piped stdio so subprocess output stays buffered and does not leak into the OpenCode TUI.
