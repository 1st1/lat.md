# lat.md

[![CI](https://github.com/1st1/lat.md/actions/workflows/ci.yml/badge.svg)](https://github.com/1st1/lat.md/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lat.md)](https://www.npmjs.com/package/lat.md)

A knowledge graph for your codebase, written in markdown.

## The problem

`AGENTS.md` doesn't scale. A single flat file can describe a small project, but as a codebase grows, maintaining one monolithic document becomes impractical. Key design decisions get buried, business logic goes undocumented, and agents hallucinate context they should be able to look up.

## The idea

Compress the knowledge about your program domain into a **graph** — a set of interconnected markdown files that live in a `lat.md/` directory at the root of your project. Sections link to each other with `[[wiki links]]`, source files link back with `// @lat:` comments, and `lat check` ensures nothing drifts out of sync.

The result is a structured knowledge base that:

- 📈 **Scales** — split knowledge across as many files and sections as you need
- 🔗 **Cross-references** — wiki links (`[[cli#search#Indexing]]`) connect concepts into a navigable graph
- ✅ **Stays in sync** — `lat check` validates that all links resolve and that required code references exist
- 🔍 **Is searchable** — exact, fuzzy, and semantic (vector) search across all sections
- 🤝 **Works for humans and machines** — readable in any editor (or Obsidian), queryable by agents via the `lat` CLI

## Install

```bash
npm install -g lat.md
```

Or use directly with `npx lat.md@latest <command>`.

For semantic search (`lat search`), provide an OpenAI (`sk-...`) or Vercel AI Gateway (`vck_...`) API key via one of:

```bash
export LAT_LLM_KEY=sk-...                # direct value
export LAT_LLM_KEY_FILE=~/.secrets/lat    # path to a file containing the key
export LAT_LLM_KEY_HELPER='security find-generic-password -a "$USER" -s "LAT_LLM_KEY" -w'  # command that prints the key
```

## How it works

Run `lat init` to scaffold a `lat.md/` directory, then write markdown files describing your architecture, business logic, test specs — whatever matters. Link between sections using `[[file#Section#Subsection]]` syntax. Annotate source code with `// @lat: [[section-id]]` (or `# @lat: [[section-id]]` in Python) comments to tie implementation back to concepts.

```
my-project/
├── lat.md/
│   ├── architecture.md    # system design, key decisions
│   ├── auth.md            # authentication & authorization logic
│   └── tests.md           # test specs (require-code-mention: true)
├── src/
│   ├── auth.ts            # // @lat: [[auth#OAuth Flow]]
│   └── server.ts          # // @lat: [[architecture#Request Pipeline]]
└── ...
```

## CLI

```bash
npx lat.md init                        # scaffold a lat.md/ directory
npx lat.md check                       # validate all wiki links and code refs
npx lat.md locate "OAuth Flow"         # find sections by name (exact, fuzzy)
npx lat.md refs "auth#OAuth Flow"      # find what references a section
npx lat.md search "how do we auth?"    # semantic search via embeddings
npx lat.md prompt "fix [[OAuth Flow]]" # expand [[refs]] in a prompt for agents
```

## Development

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm build
pnpm test
```
