# Roundtrip

Parse → render fidelity test for the [[parser]]. The fixture `tests/roundtrip.md` exercises every supported markdown and wiki link feature. The test reads it, runs `parse()` → `toMarkdown()`, and asserts the output is identical to the input.

Must be updated whenever the wiki link syntax or markdown rendering changes. If a new syntactic feature is added, add it to the fixture. If the roundtrip breaks, the parser or renderer lost fidelity.

## Covered features

The roundtrip fixture exercises all supported markdown and wiki link syntax features.

Headings (all 6 levels), paragraphs, emphasis, strong, strong emphasis, strikethrough, inline code, fenced code blocks (with and without language), explicit and bare links, images (standalone and inline), blockquotes (including nested), ordered, unordered, and task lists, thematic breaks, hard line breaks, escaped characters, GitHub-flavored tables, and every wiki link variation: `[[file]]`, `[[file#Heading]]`, `[[file#H1#H2]]`, `[[path/file#H1#H2]]`, each with and without aliases.
