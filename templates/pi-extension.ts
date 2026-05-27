import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme, keyHint } from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-tui";
import { Box, Markdown, Text } from "@mariozechner/pi-tui";

const PREVIEW_LINES = 4;

function collapsibleResult(
  result: { content: Array<{ type: string; text?: string }> },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
) {
  const text = result.content?.[0]?.type === "text" ? (result.content[0] as { type: "text"; text: string }).text : "";
  if (!text) return new Text(theme.fg("dim", "(empty)"), 0, 0);
  if (options.isPartial) return new Text(theme.fg("dim", "…"), 0, 0);
  const mdTheme = getMarkdownTheme();
  if (options.expanded) return new Markdown(text, 0, 0, mdTheme);

  const lines = text.split("\n");
  if (lines.length <= PREVIEW_LINES) return new Markdown(text, 0, 0, mdTheme);

  const preview = lines.slice(0, PREVIEW_LINES).join("\n");
  const remaining = lines.length - PREVIEW_LINES;
  const hint = keyHint("expandTools", "to expand");
  return new Text(
    preview + "\n" +
    theme.fg("dim", `… ${remaining} more lines (${hint})`),
    0, 0,
  );
}

/** Absolute path to the lat binary, injected by `lat init`. */
const LAT = "__LAT_BIN__";

function run(args: string[], cwd?: string): string {
  const { execSync } = require("child_process") as typeof import("child_process");
  return execSync(`${LAT} ${args.join(" ")}`, {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
    timeout: 30_000,
  });
}

function tryRun(args: string[]): string {
  try {
    return run(args);
  } catch {
    return "";
  }
}

export default function (pi: ExtensionAPI) {
  // ── Tools ──────────────────────────────────────────────────────────

  pi.registerTool({
    name: "lat_search",
    label: "lat search",
    description: "Semantic search across lat.md sections using embeddings",
    promptSnippet: "Search lat.md documentation by meaning",
    promptGuidelines: [
      "Use before starting any task to find relevant design context",
      "Search results include section IDs you can pass to lat_section",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query in natural language" }),
      limit: Type.Optional(
        Type.Number({ description: "Max results (default 5)", default: 5 }),
      ),
    }),
    async execute(_id, params) {
      const args = ["search", JSON.stringify(params.query)];
      if (params.limit) args.push("--limit", String(params.limit));
      const output = tryRun(args);
      return {
        content: [{ type: "text", text: output || "No results found." }],
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("lat search ")) +
        theme.fg("dim", `"${args.query}"`),
        0, 0,
      );
    },
    renderResult: collapsibleResult,
  });

  pi.registerTool({
    name: "lat_section",
    label: "lat section",
    description:
      "Show full content of a lat.md section with outgoing/incoming refs",
    promptSnippet: "Read a specific lat.md section",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Section ID or name (e.g. "cli#init", "Tests#User login")',
      }),
    }),
    async execute(_id, params) {
      const output = tryRun(["section", JSON.stringify(params.query)]);
      return {
        content: [
          { type: "text", text: output || "Section not found." },
        ],
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("lat section ")) +
        theme.fg("dim", `"${args.query}"`),
        0, 0,
      );
    },
    renderResult: collapsibleResult,
  });

  pi.registerTool({
    name: "lat_locate",
    label: "lat locate",
    description:
      "Find a section by name (exact, subsection tail, or fuzzy match)",
    promptSnippet: "Find a lat.md section by name",
    parameters: Type.Object({
      query: Type.String({ description: "Section name to locate" }),
    }),
    async execute(_id, params) {
      const output = tryRun(["locate", JSON.stringify(params.query)]);
      return {
        content: [
          { type: "text", text: output || "No sections matching query." },
        ],
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("lat locate ")) +
        theme.fg("dim", `"${args.query}"`),
        0, 0,
      );
    },
  });

  pi.registerTool({
    name: "lat_check",
    label: "lat check",
    description:
      "Run full lat.md validation. Returns errors or 'All checks passed'",
    promptSnippet: "Run full lat.md validation",
    parameters: Type.Object({}),
    async execute() {
      try {
        const output = run(["check"]);
        return { content: [{ type: "text", text: output }] };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string };
        return {
          content: [{ type: "text", text: e.stdout || e.stderr || "Check failed" }],
          isError: true,
        };
      }
    },
    renderCall(_args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("lat check")),
        0, 0,
      );
    },
  });

  pi.registerTool({
    name: "lat_expand",
    label: "lat expand",
    description:
      "Expand [[refs]] in text to resolved file locations and context",
    promptSnippet: "Resolve [[wiki links]] in text",
    parameters: Type.Object({
      text: Type.String({ description: "Text containing [[refs]] to expand" }),
    }),
    async execute(_id, params) {
      const output = tryRun(["expand", JSON.stringify(params.text)]);
      return {
        content: [{ type: "text", text: output || params.text }],
      };
    },
    renderCall(args, theme) {
      const preview = args.text.length > 60 ? args.text.slice(0, 60) + "…" : args.text;
      return new Text(
        theme.fg("toolTitle", theme.bold("lat expand ")) +
        theme.fg("dim", `"${preview}"`),
        0, 0,
      );
    },
  });

  pi.registerTool({
    name: "lat_refs",
    label: "lat refs",
    description: "Find what references a given section",
    promptSnippet: "Find incoming references to a lat.md section",
    parameters: Type.Object({
      query: Type.String({
        description: 'Section ID (e.g. "cli#init", "file#Section")',
      }),
    }),
    async execute(_id, params) {
      const output = tryRun(["refs", JSON.stringify(params.query)]);
      return {
        content: [{ type: "text", text: output || "No references found." }],
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("lat refs ")) +
        theme.fg("dim", `"${args.query}"`),
        0, 0,
      );
    },
  });

  // ── Message renderers ────────────────────────────────────────────

  pi.registerMessageRenderer("lat-reminder", (message, { expanded }, theme) => {
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    if (expanded) {
      box.addChild(new Text(theme.fg("accent", "lat.md"), 0, 0));
      box.addChild(new Markdown(message.content, 0, 0, getMarkdownTheme()));
    } else {
      const hint = keyHint("expandTools", "to expand");
      box.addChild(new Text(
        theme.fg("accent", "lat.md") + " " +
        theme.fg("dim", `Search lat.md before starting work. Keep lat.md/ focused. (${hint})`),
        0, 0,
      ));
    }
    return box;
  });

  pi.registerMessageRenderer("lat-check", (message, { expanded }, theme) => {
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    if (expanded) {
      box.addChild(new Text(theme.fg("warning", "lat check"), 0, 0));
      box.addChild(new Markdown(message.content, 0, 0, getMarkdownTheme()));
    } else {
      const hint = keyHint("expandTools", "to expand");
      const firstLine = message.content.split("\n")[0];
      box.addChild(new Text(
        theme.fg("warning", "lat check") + " " +
        theme.fg("dim", `${firstLine} (${hint})`),
        0, 0,
      ));
    }
    return box;
  });

  // ── Lifecycle hooks ────────────────────────────────────────────────

  // Guard to prevent agent_end from firing twice per prompt (infinite loop)
  let agentEndFired = false;

  pi.on("before_agent_start", async () => {
    agentEndFired = false;

    const reminder = [
      "Before starting work, run `lat_search` with one or more queries describing the user's intent.",
      "ALWAYS do this, even when the task seems straightforward — search results may reveal critical design details, protocols, or constraints.",
      "Use `lat_section` to read the full content of relevant matches.",
      "Do not read files, write code, or run commands until you have searched.",
      "",
      "Remember: `lat.md/` must stay in sync with meaningful codebase state. If you change behavior, architecture, tests, or planned work, update the relevant current-state sections and run `lat_check` before finishing. Do not use `lat.md/` as a journal/changelog or add notes for insignificant details.",
    ].join("\n");

    return {
      message: {
        customType: "lat-reminder",
        content: reminder,
        display: true,
      },
    };
  });

  pi.on("agent_end", async () => {
    // Don't fire twice per prompt — prevents infinite loop
    if (agentEndFired) return;
    agentEndFired = true;

    // Run lat check
    let checkOutput: string;
    let checkFailed = false;
    try {
      checkOutput = run(["check"]);
    } catch (err: unknown) {
      checkFailed = true;
      checkOutput = (err as { stdout?: string }).stdout || "";
    }

    // Run git diff --numstat to check if lat.md/ is in sync
    let needsSync = false;
    let codeLines = 0;
    try {
      const { execSync } = require("child_process") as typeof import("child_process");
      const numstat = execSync("git diff HEAD --numstat", {
        encoding: "utf-8",
        cwd: process.cwd(),
      });

      let latMdLines = 0;
      for (const line of numstat.split("\n")) {
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const added = parseInt(parts[0], 10) || 0;
        const removed = parseInt(parts[1], 10) || 0;
        const file = parts[2];
        const changed = added + removed;
        if (file.startsWith("lat.md/")) {
          latMdLines += changed;
        } else if (/\.(ts|tsx|js|jsx|py|rs|go|c|h)$/.test(file)) {
          codeLines += changed;
        }
      }

      if (codeLines >= 5) {
        const effectiveLatMd = latMdLines === 0 ? 0 : Math.max(latMdLines, 1);
        needsSync = effectiveLatMd < codeLines * 0.05;
      }
    } catch {
      // git not available or no HEAD — skip diff check
    }

    if (!checkFailed && !needsSync) return;

    const parts: string[] = [];
    if (checkFailed && needsSync) {
      parts.push(
        `\`lat check\` found errors AND the codebase has changes (${codeLines} lines) with no updates to \`lat.md/\`. Before finishing:`,
        "",
        "1. Update relevant current-state `lat.md/` sections if the changes affect behavior, architecture, tests, or plans; do not add journal/changelog notes.",
        "2. Run `lat_check` until it passes.",
      );
    } else if (checkFailed) {
      parts.push(
        "`lat check` failed. Run `lat_check`, fix the errors, and repeat until it passes.",
      );
    } else {
      parts.push(
        `The codebase has changes (${codeLines} lines) but \`lat.md/\` was not updated. Review whether current-state \`lat.md/\` sections need updates; do not add journal/changelog notes just to satisfy this reminder. Run \`lat_search\` to find relevant sections and \`lat_check\` at the end.`,
      );
    }

    pi.sendMessage(
      { customType: "lat-check", content: parts.join("\n"), display: true },
      { deliverAs: "followUp", triggerTurn: true },
    );
  });
}
