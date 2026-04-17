import { type Plugin, tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"

/** Absolute path to the lat binary, injected by `lat init`. */
const LAT = "__LAT_BIN__"

function run(args: string[]): string {
  return execSync(`${LAT} ${args.join(" ")}`, {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 30_000,
  })
}

function tryRun(args: string[]): string {
  try {
    return run(args)
  } catch {
    return ""
  }
}

export const LatPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      lat_search: tool({
        description:
          "Semantic search across lat.md sections using embeddings. Use before starting any task to find relevant design context.",
        args: {
          query: tool.schema.string("Search query in natural language"),
          limit: tool.schema.optional(
            tool.schema.number("Max results (default 5)"),
          ),
        },
        async execute(args) {
          const cliArgs = ["search", JSON.stringify(args.query)]
          if (args.limit) cliArgs.push("--limit", String(args.limit))
          const output = tryRun(cliArgs)
          return output || "No results found."
        },
      }),

      lat_section: tool({
        description:
          "Show full content of a lat.md section with outgoing/incoming refs",
        args: {
          query: tool.schema.string(
            'Section ID or name (e.g. "cli#init", "Tests#User login")',
          ),
        },
        async execute(args) {
          const output = tryRun(["section", JSON.stringify(args.query)])
          return output || "Section not found."
        },
      }),

      lat_locate: tool({
        description:
          "Find a section by name (exact, subsection tail, or fuzzy match)",
        args: {
          query: tool.schema.string("Section name to locate"),
        },
        async execute(args) {
          const output = tryRun(["locate", JSON.stringify(args.query)])
          return output || "No sections matching query."
        },
      }),

      lat_check: tool({
        description:
          "Run full lat.md validation. Returns errors or 'All checks passed'",
        args: {},
        async execute() {
          try {
            return run(["check"])
          } catch (err: unknown) {
            const e = err as { stdout?: string; stderr?: string }
            return e.stdout || e.stderr || "Check failed"
          }
        },
      }),

      lat_expand: tool({
        description:
          "Expand [[refs]] in text to resolved file locations and context",
        args: {
          text: tool.schema.string("Text containing [[refs]] to expand"),
        },
        async execute(args) {
          const output = tryRun(["expand", JSON.stringify(args.text)])
          return output || args.text
        },
      }),

      lat_refs: tool({
        description:
          "Find what references a given section via wiki links or @lat code comments",
        args: {
          query: tool.schema.string(
            'Section ID (e.g. "cli#init", "file#Section")',
          ),
        },
        async execute(args) {
          const output = tryRun(["refs", JSON.stringify(args.query)])
          return output || "No references found."
        },
      }),

      lat_get_source: tool({
        description:
          'Return the active location for a configured external source handle',
        args: {
          externalSource: tool.schema.string(
            'External source handle (e.g. "architecture-docs")',
          ),
        },
        async execute(args) {
          const output = tryRun(['get-source', args.externalSource]);
          return output || 'External source not found.';
        },
      }),
    },

    hooks: {
      "session.idle": async () => {
        let checkFailed = false
        let checkOutput = ""
        try {
          checkOutput = run(["check"])
        } catch (err: unknown) {
          checkFailed = true
          checkOutput = (err as { stdout?: string }).stdout || ""
        }

        // Check git diff for lat.md/ sync status
        let needsSync = false
        let codeLines = 0
        try {
          const numstat = execSync("git diff HEAD --numstat", {
            encoding: "utf-8",
            cwd: process.cwd(),
          })

          let latMdLines = 0
          for (const line of numstat.split("\n")) {
            const parts = line.split("\t")
            if (parts.length < 3) continue
            const added = parseInt(parts[0], 10) || 0
            const removed = parseInt(parts[1], 10) || 0
            const file = parts[2]
            const changed = added + removed
            if (file.startsWith("lat.md/")) {
              latMdLines += changed
            } else if (/\.(ts|tsx|js|jsx|py|rs|go|c|h)$/.test(file)) {
              codeLines += changed
            }
          }

          if (codeLines >= 5) {
            const effectiveLatMd =
              latMdLines === 0 ? 0 : Math.max(latMdLines, 1)
            needsSync = effectiveLatMd < codeLines * 0.05
          }
        } catch {
          // git not available or no HEAD — skip diff check
        }

        if (!checkFailed && !needsSync) return

        const message =
          checkFailed && needsSync
            ? `lat check failed and lat.md/ may be out of sync (${codeLines} code lines changed). Run lat_check, fix errors, and update only relevant current-state lat.md/ sections. Do not add journal/changelog notes.`
            : checkFailed
              ? `lat check failed. Run lat_check and fix the errors.`
              : `lat.md/ may be out of sync — ${codeLines} code lines changed but lat.md/ was not updated. Review whether current-state lat.md/ sections need updates; do not add journal/changelog notes. Run lat_check.`

        await ctx.client.app.log({
          body: {
            service: "lat.md",
            level: "warn",
            message,
          },
        })
      },
    },
  }
}
