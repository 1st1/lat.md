---
lat:
  require-code-mention: true
---
# MCP

Functional tests for the MCP server. Spawns `lat mcp` against the `basic-project` fixture via the MCP client SDK and verifies each tool responds correctly.

Tests in `tests/mcp.test.ts`.

## Lists all tools
Server exposes exactly `lat_check`, `lat_expand`, `lat_get_source`, `lat_locate`, `lat_refs`, `lat_search`, `lat_section`.

## lat_locate finds a section
Calling `lat_locate` with query `"Testing"` returns a result containing `dev-process#Testing`.

## lat_locate returns message for missing section
Calling `lat_locate` with a nonexistent query returns a "No sections matching" message instead of erroring.

## lat_expand expands refs
Calling `lat_expand` with text containing `[[dev-process#Testing]]` returns expanded output with a `<lat-context>` block.

## lat_expand passes through text without refs
Calling `lat_expand` with plain text (no `[[refs]]`) returns the input unchanged.

## lat_section shows section content

Calling `lat_section` with query `"notes#Second Topic"` returns the section content including the raw wiki link text, a "This section references" block with `dev-process#Testing`, and the section id.

## lat_section returns message for missing section

Calling `lat_section` with a nonexistent query returns a "No sections matching" message.

## lat_check reports errors
Calling `lat_check` against `basic-project` (which has no index file) returns an error response with `isError: true`.

## lat_search finds auth section
Semantic search via `lat_search` for a login/security query returns results containing the Authentication section. Uses the RAG replay server against the `rag` fixture.

## lat_search finds performance section
Semantic search for a latency/response-times query returns results containing the Performance section.

## lat_search returns no results message
When `LAT_LLM_KEY` is not set, `lat_search` returns an error with `isError: true` explaining the missing key.

## lat_get_source returns canonical repo URL

Calling `lat_get_source` with a configured external handle returns the canonical repository URL when no local override is active.
