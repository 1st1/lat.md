# Knowledge

This is Lat's own working knowledge graph: the architecture, constraints, and test intent that document and drive the evolution of Lat itself.

Public [[docs]] explain how to use the product. This directory records what the implementation must do and why, and source/test `@lat:` references keep those decisions connected to code. It is both the subject and a real-world demonstration of Lat.

- [[architecture-analysis|analysis]] — Shared AST-free Markdown analysis, project snapshots, validation, and worker execution
- [[cli]] — CLI commands, options, and output contracts
- [[dev-process]] — Development tooling, testing, site building, and publishing conventions
- [[external-sources]] — External repository references, retrieval providers, caching, and security boundaries
- [[markdown]] — Markdown syntax and validation rules supported by Lat
- [[parser]] — Parsing architecture, section trees, and reference extraction
- [[site]] — Static `lat ui` deployment of this repository's vault
- [[tests]] — High-level test specifications mapped to code
- [[view]] — Browser architecture and functional specifications
