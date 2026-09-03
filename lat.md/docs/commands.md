# Commands

The `lat` CLI initializes, validates, searches, inspects, and publishes a project's knowledge graph.

| Command                                              | Purpose                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `lat init [dir]`                                     | Create a vault and configure coding agents                      |
| `lat check`                                          | Validate the complete graph and its code relationships          |
| `lat search <query>`                                 | Search sections semantically                                    |
| `lat locate <query>`                                 | Find a section by exact or fuzzy id                             |
| `lat section <target>`                               | Show a section with outgoing and incoming references            |
| `lat refs <target>`                                  | Find Markdown and code backlinks                                |
| `lat expand <text>`                                  | Resolve wiki links and append context for an agent              |
| `lat reindex`                                        | Rebuild semantic search or switch embedding backends            |
| `lat external ...`                                   | Configure and inspect [[upstream]]                              |
| `lat ui` / `lat ui run`                              | Open the local [[browser]]; `--no-git` disables Git integration |
| `lat ui build static [output]`                       | Export a fully static, read-only site                           |
| `lat ui build server [output] --target node\|vercel` | Export a portable Express server or Vercel Build Output API v3  |
| `lat mcp`                                            | Serve Lat tools over MCP                                        |
| `lat gen <target>`                                   | Print an agent integration template                             |
| `lat config`                                         | Show the user configuration path                                |

Run `lat <command> --help` for options. `lat check --profile` explains validation time, `lat search --debug` shows similarity scores, and most read commands accept either short section ids or exact `lat.md/...` ids.
