This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

**Markdown-first.** This project is built around markdown and its output should reflect that. CLI error messages, diagnostics, and reports use structured, readable formatting — bullet-point lists, indented context, and clear spacing between items — so output is scannable both by humans and by LLM-based agents consuming it.

- [[cli]] — CLI commands, options, and output formats for the `lat` tool
- [[architecture-analysis|analysis]] — Shared AST-free Markdown analysis, project snapshots, validation, and worker execution
- [[dev-process]] — Development tooling, testing, formatting, and publishing conventions
- [[external-sources]] — External repository references, retrieval providers, caching, and design boundaries
- [[markdown]] — Markdown extensions (wiki links, frontmatter) used in lat.md files
- [[parser]] — Markdown parsing architecture, section tree construction, and ref extraction
- [[rag-architecture]] — Implemented passage indexing, hybrid section ranking, embedding reuse, and deployment
- [[search-audit]] — Retrieval experiments and priorities for further relevance tuning
- [[tests]] — High-level test specifications mapped to code via require-code-mention
- [[view]] — Local browser architecture and test specifications
- [[website]] — Standalone Next.js marketing site deployed to Vercel
