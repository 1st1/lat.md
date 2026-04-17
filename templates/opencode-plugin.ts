import { type Plugin, tool } from '@opencode-ai/plugin';
import { spawnSync } from 'child_process';

/** Absolute path to the lat binary, injected by `lat init`. */
const LAT = '__LAT_BIN__';

function quote(arg: string): string {
  return JSON.stringify(arg);
}

function projectRoot(directory: string, worktree: string): string {
  return worktree && worktree !== '/' ? worktree : directory;
}

function command(command: string, cwd: string) {
  const result = spawnSync(command, {
    cwd,
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status === 0) return result.stdout ?? '';

  const error = new Error(
    result.stderr ||
      result.stdout ||
      `Command failed with exit code ${result.status ?? 'unknown'}`,
  ) as Error & {
    stdout?: string;
    stderr?: string;
  };
  error.stdout = result.stdout ?? '';
  error.stderr = result.stderr ?? '';
  throw error;
}

function run(args: string[], cwd: string): string {
  return command([LAT, ...args.map(quote)].join(' '), cwd);
}

function tryRun(args: string[], cwd: string): string {
  try {
    return run(args, cwd);
  } catch {
    return '';
  }
}

export const LatPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      lat_search: tool({
        description:
          'Semantic search across lat.md sections using embeddings. Use before starting any task to find relevant design context.',
        args: {
          query: tool.schema.string('Search query in natural language'),
          limit: tool.schema.optional(
            tool.schema.number('Max results (default 5)'),
          ),
        },
        async execute(args, context) {
          const cliArgs = ['search', args.query];
          if (args.limit !== undefined)
            cliArgs.push('--limit', String(args.limit));
          const output = tryRun(
            cliArgs,
            projectRoot(context.directory, context.worktree),
          );
          return output || 'No results found.';
        },
      }),

      lat_section: tool({
        description:
          'Show full content of a lat.md section with outgoing/incoming refs',
        args: {
          query: tool.schema.string(
            'Section ID or name (e.g. "cli#init", "Tests#User login")',
          ),
        },
        async execute(args, context) {
          const output = tryRun(
            ['section', args.query],
            projectRoot(context.directory, context.worktree),
          );
          return output || 'Section not found.';
        },
      }),

      lat_locate: tool({
        description:
          'Find a section by name (exact, subsection tail, or fuzzy match)',
        args: {
          query: tool.schema.string('Section name to locate'),
        },
        async execute(args, context) {
          const output = tryRun(
            ['locate', args.query],
            projectRoot(context.directory, context.worktree),
          );
          return output || 'No sections matching query.';
        },
      }),

      lat_check: tool({
        description:
          "Validate all wiki links and code refs in lat.md. Returns errors or 'All checks passed'",
        args: {},
        async execute(_args, context) {
          try {
            return run(
              ['check'],
              projectRoot(context.directory, context.worktree),
            );
          } catch (err: unknown) {
            const e = err as { stdout?: string; stderr?: string };
            return e.stdout || e.stderr || 'Check failed';
          }
        },
      }),

      lat_expand: tool({
        description:
          'Expand [[refs]] in text to resolved file locations and context',
        args: {
          text: tool.schema.string('Text containing [[refs]] to expand'),
        },
        async execute(args, context) {
          const output = tryRun(
            ['expand', args.text],
            projectRoot(context.directory, context.worktree),
          );
          return output || args.text;
        },
      }),

      lat_refs: tool({
        description:
          'Find what references a given section via wiki links or @lat code comments',
        args: {
          query: tool.schema.string(
            'Section ID (e.g. "cli#init", "file#Section")',
          ),
        },
        async execute(args, context) {
          const output = tryRun(
            ['refs', args.query],
            projectRoot(context.directory, context.worktree),
          );
          return output || 'No references found.';
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type !== 'session.idle') return;

      const cwd = projectRoot(ctx.directory, ctx.worktree);

      let checkFailed = false;
      let checkOutput = '';
      try {
        checkOutput = run(['check'], cwd);
      } catch (err: unknown) {
        checkFailed = true;
        const error = err as { stdout?: string; stderr?: string };
        checkOutput = error.stdout || error.stderr || '';
      }

      // Check git diff for lat.md/ sync status
      let needsSync = false;
      let codeLines = 0;
      try {
        const numstat = command('git diff HEAD --numstat', cwd);

        let latMdLines = 0;
        for (const line of numstat.split('\n')) {
          const parts = line.split('\t');
          if (parts.length < 3) continue;
          const added = parseInt(parts[0], 10) || 0;
          const removed = parseInt(parts[1], 10) || 0;
          const file = parts[2];
          const changed = added + removed;
          if (file.startsWith('lat.md/')) {
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

      const message =
        checkFailed && needsSync
          ? `lat check failed and lat.md/ may be out of sync (${codeLines} code lines changed). Run lat_check, fix errors, and update lat.md/.`
          : checkFailed
            ? `lat check failed. Run lat_check and fix the errors.`
            : `lat.md/ may be out of sync — ${codeLines} code lines changed but lat.md/ was not updated. Update lat.md/ and run lat_check.`;

      await ctx.client.app.log({
        body: {
          service: 'lat.md',
          level: 'warn',
          message,
        },
      });
    },
  };
};
