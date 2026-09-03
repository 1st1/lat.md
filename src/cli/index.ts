#!/usr/bin/env node

// Suppress deprecation warnings from transitive dependencies unless --verbose
if (!process.argv.includes('--verbose')) {
  process.noDeprecation = true;
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { resolveCheckContext, resolveContext } from './context.js';
import type { CmdResult } from '../context.js';
import {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_THRESHOLD,
} from '../search/search.js';

type CheckTargetArgs = {
  args: string[];
  target?: string;
};

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('port must be an integer from 1 to 65535');
  }
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new InvalidArgumentError('port must be an integer from 1 to 65535');
  }
  return port;
}

type UiRunOptions = {
  git: boolean;
  logoText?: string;
  port?: number;
};

type UiServerBuildTarget = 'node' | 'vercel';

function parseUiServerBuildTarget(value: string): UiServerBuildTarget {
  if (value !== 'node' && value !== 'vercel') {
    throw new InvalidArgumentError('target must be node or vercel');
  }
  return value;
}

function configureUiRun(command: Command): Command {
  return command
    .option('--logo-text <text>', 'top-left logo text')
    .option('--no-git', 'disable Git working-tree integration')
    .option(
      '--port <number>',
      'server port (default: 4242; explicit ports are strict)',
      parsePort,
    );
}

function parseSimilarityThreshold(value: string): number {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new InvalidArgumentError('threshold must be a number from 0 to 1');
  }
  return threshold;
}

/** Reserve `-- <directory>` for an explicit check target. */
function splitCheckTarget(args: string[]): CheckTargetArgs {
  let commandIndex = -1;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dir') {
      i++;
      continue;
    }
    if (arg.startsWith('--dir=')) continue;
    if (arg.startsWith('-')) continue;
    commandIndex = i;
    break;
  }

  if (commandIndex === -1 || args[commandIndex] !== 'check') {
    return { args };
  }

  const separatorIndex = args.indexOf('--', commandIndex + 1);
  if (separatorIndex === -1) return { args };

  const targets = args.slice(separatorIndex + 1);
  if (targets.length !== 1 || targets[0] === '') {
    console.error(
      'error: `lat check --` expects exactly one directory after `--`',
    );
    process.exit(1);
  }

  return {
    args: args.slice(0, separatorIndex),
    target: targets[0],
  };
}

const checkTargetArgs = splitCheckTarget(process.argv.slice(2));

function findPackageJson(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(dir, 'package.json');
    try {
      return JSON.parse(readFileSync(candidate, 'utf-8')).version;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) return '0.0.0';
    dir = parent;
  }
}

function handleResult(result: CmdResult): void {
  if (result.isError) {
    console.error(result.output);
    process.exit(1);
  }
  if (result.output) console.log(result.output);
}

const version = findPackageJson();

const program = new Command();

program
  .name('lat')
  .description('Anchor source code to high-level concepts defined in markdown')
  .version(version)
  .option('--dir <path>', 'project root to look for lat.md in (default: cwd)')
  .option('--no-color', 'disable color output')
  .option('--verbose', 'show deprecation warnings and extra diagnostics');

program
  .command('locate')
  .description('Find sections by id')
  .argument('<query>', 'section id to search for')
  .action(async (query: string) => {
    const ctx = resolveContext(program.opts());
    const { locateCommand } = await import('./locate.js');
    handleResult(await locateCommand(ctx, query));
  });

program
  .command('section')
  .description(
    'Show a section with its content, outgoing refs, and incoming refs',
  )
  .argument('<query>', 'section id to look up')
  .action(async (query: string) => {
    const ctx = resolveContext(program.opts());
    const { sectionCommand } = await import('./section.js');
    handleResult(await sectionCommand(ctx, query));
  });

async function runUi(opts: UiRunOptions): Promise<void> {
  const ctx = resolveContext(program.opts());
  const { uiCommand } = await import('./ui.js');
  handleResult(
    await uiCommand(ctx, {
      git: opts.git,
      logoText: opts.logoText,
      port: opts.port,
    }),
  );
}

const ui = configureUiRun(
  program.command('ui').description('Run or build the Lat UI'),
).action(runUi);

configureUiRun(
  ui.command('run').description('Run the local Lat UI server'),
).action(async (opts: UiRunOptions) => {
  await runUi(opts);
});

const uiBuild = ui.command('build').description('Build a deployable Lat UI');

uiBuild
  .command('static')
  .description('Build a fully static, read-only Lat UI')
  .argument(
    '[output]',
    'output directory relative to the project (default: .lat-build/static)',
    '.lat-build/static',
  )
  .option('--base <path>', 'deployment base path', '/')
  .option('--force', 'replace an existing output path')
  .option('--logo-text <text>', 'top-left logo text')
  .action(
    async (
      output: string,
      opts: { base: string; force?: boolean; logoText?: string },
    ) => {
      const ctx = resolveContext(program.opts());
      const { uiBuildCommand } = await import('./ui-build.js');
      handleResult(
        await uiBuildCommand(ctx, output, {
          basePath: opts.base,
          force: opts.force,
          logoText:
            opts.logoText ?? (ui.opts() as { logoText?: string }).logoText,
        }),
      );
    },
  );

uiBuild
  .command('server')
  .description('Build a static Lat UI with a portable search server')
  .argument(
    '[output]',
    'output directory (default: .lat-build/server for node, .vercel/output for vercel)',
  )
  .option('--base <path>', 'deployment base path', '/')
  .option('--force', 'replace an existing output path')
  .option('--logo-text <text>', 'top-left logo text')
  .option(
    '--target <target>',
    'deployment target: node or vercel',
    parseUiServerBuildTarget,
    'node',
  )
  .action(
    async (
      output: string | undefined,
      opts: {
        base: string;
        force?: boolean;
        logoText?: string;
        target: UiServerBuildTarget;
      },
    ) => {
      const ctx = resolveContext(program.opts());
      const { uiBuildServerCommand } = await import('./ui-build-server.js');
      handleResult(
        await uiBuildServerCommand(ctx, output, {
          basePath: opts.base,
          force: opts.force,
          logoText:
            opts.logoText ?? (ui.opts() as { logoText?: string }).logoText,
          target: opts.target,
        }),
      );
    },
  );

program
  .command('refs')
  .description('Find references to a section')
  .argument('<query>', 'section id to find references for')
  .option('--scope <scope>', 'where to search: md, code, or md+code', 'md+code')
  .action(async (query: string, opts: { scope: string }) => {
    const scope = opts.scope;
    if (scope !== 'md' && scope !== 'code' && scope !== 'md+code') {
      console.error(`Unknown scope: ${scope}. Use md, code, or md+code.`);
      process.exit(1);
    }
    const ctx = resolveContext(program.opts());
    const { refsCommand } = await import('./refs.js');
    handleResult(await refsCommand(ctx, query, scope));
  });

const external = program
  .command('external')
  .description('Manage pinned external source repositories');

external
  .command('add')
  .argument('[handle]', 'stable external source handle')
  .argument('[repo]', 'canonical HTTPS Git repository')
  .option('--commit <commit-or-ref>', 'commit, branch, or tag to pin')
  .option('--prefix <path>', 'repository path prefix')
  .option(
    '--default-file-extension <extension>',
    'extension for external paths that omit one',
  )
  .option('--strategy <strategy>', 'retrieval strategy: fetch or checkout')
  .option('--fetch-url <template>', 'raw-file URL template')
  .action(
    async (
      handle: string | undefined,
      repo: string | undefined,
      opts: {
        commit?: string;
        prefix?: string;
        defaultFileExtension?: string;
        strategy?: string;
        fetchUrl?: string;
      },
    ) => {
      const ctx = resolveContext(program.opts());
      const { externalAddCommand } = await import('./external.js');
      handleResult(await externalAddCommand(ctx, handle, repo, opts));
    },
  );

external
  .command('show')
  .argument('<source>', 'handle or exact external target')
  .option('--json', 'emit structured JSON')
  .action(async (source: string, opts: { json?: boolean }) => {
    const ctx = resolveContext(program.opts());
    const { externalShowCommand } = await import('./external.js');
    handleResult(await externalShowCommand(ctx, source, !!opts.json));
  });

external
  .command('list')
  .option('--json', 'emit structured JSON')
  .action(async (opts: { json?: boolean }) => {
    const ctx = resolveContext(program.opts());
    const { externalListCommand } = await import('./external.js');
    handleResult(await externalListCommand(ctx, !!opts.json));
  });

const check = program
  .command('check')
  .usage('[subcommand] [-- <directory>]')
  .description('Validate markdown, links, code references, and structure')
  .option('--profile', 'show detailed validation timing')
  .action(async (opts: { profile?: boolean }) => {
    const ctx = resolveCheckContext(program.opts(), checkTargetArgs.target);
    const { checkAllCommand } = await import('./check.js');
    handleResult(await checkAllCommand(ctx, { profile: !!opts.profile }));
  });

check
  .command('md')
  .usage('[-- <directory>]')
  .description('Validate wiki links in markdown files')
  .action(async () => {
    const ctx = resolveCheckContext(program.opts(), checkTargetArgs.target);
    const { checkMdCommand } = await import('./check.js');
    handleResult(await checkMdCommand(ctx));
  });

check
  .command('links')
  .usage('[-- <directory>]')
  .description('Validate relative markdown links')
  .action(async () => {
    const ctx = resolveCheckContext(program.opts(), checkTargetArgs.target);
    const { checkLinksCommand } = await import('./check.js');
    handleResult(await checkLinksCommand(ctx));
  });

check
  .command('code-refs')
  .usage('[-- <directory>]')
  .description('Validate @lat code references and coverage')
  .action(async () => {
    const ctx = resolveCheckContext(program.opts(), checkTargetArgs.target);
    const { checkCodeRefsCommand } = await import('./check.js');
    handleResult(await checkCodeRefsCommand(ctx));
  });

check
  .command('index')
  .usage('[-- <directory>]')
  .description('Validate directory index files')
  .action(async () => {
    const ctx = resolveCheckContext(program.opts(), checkTargetArgs.target);
    const { checkIndexCommand } = await import('./check.js');
    handleResult(await checkIndexCommand(ctx));
  });

check
  .command('sections')
  .usage('[-- <directory>]')
  .description('Validate section leading paragraphs')
  .action(async () => {
    const ctx = resolveCheckContext(program.opts(), checkTargetArgs.target);
    const { checkSectionsCommand } = await import('./check.js');
    handleResult(await checkSectionsCommand(ctx));
  });

async function runExpand(
  text: string | undefined,
  opts: { stdin?: boolean },
): Promise<void> {
  if (opts.stdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString('utf-8');
  }
  if (!text) {
    console.error('Provide text as an argument or use --stdin');
    process.exit(1);
  }
  const ctx = resolveContext(program.opts());
  const { expandCommand } = await import('./expand.js');
  const result = await expandCommand(ctx, text);
  if (result.isError) {
    console.error(result.output);
    process.exit(1);
  }
  // Use stdout.write (no trailing newline) for piping
  process.stdout.write(result.output);
}

program
  .command('expand')
  .description('Expand [[refs]] in text to lat.md section locations')
  .argument('[text]', 'text containing [[refs]]')
  .option('--stdin', 'read text from stdin')
  .action(runExpand);

// Deprecated alias — hidden from --help
program
  .command('prompt', { hidden: true })
  .argument('[text]')
  .option('--stdin')
  .action(async (text: string | undefined, opts: { stdin?: boolean }) => {
    console.error(
      'Warning: `lat prompt` is deprecated, use `lat expand` instead.',
    );
    await runExpand(text, opts);
  });

program
  .command('search')
  .description('Semantic search across lat.md sections')
  .argument('[query]', 'search query in plain English')
  .option(
    '--limit <n>',
    `max results (default: ${DEFAULT_SEARCH_LIMIT})`,
    String(DEFAULT_SEARCH_LIMIT),
  )
  .option('--debug', 'show result similarity scores')
  .option(
    '--threshold <score>',
    `minimum cosine similarity score (default: ${DEFAULT_SEARCH_THRESHOLD})`,
    parseSimilarityThreshold,
  )
  .action(
    async (
      query: string | undefined,
      opts: { limit: string; debug?: boolean; threshold?: number },
    ) => {
      const ctx = resolveContext(program.opts());
      const { searchCommand, cliProgress } = await import('./search.js');
      const progress = cliProgress(ctx.styler);
      const result = await searchCommand(
        ctx,
        query,
        {
          limit: parseInt(opts.limit),
          debug: opts.debug,
          threshold: opts.threshold,
        },
        progress,
      );
      handleResult(result);
    },
  );

program
  .command('reindex')
  .description('Rebuild the embedding index; switch backends if needed')
  .option('--local', 'use the local offline model (ignore LAT_LLM_KEY)')
  .option(
    '--remote',
    'use the hosted API from LAT_LLM_KEY (override a local pin)',
  )
  .option('--yes', 'assume yes to prompts (non-interactive)')
  .action(
    async (opts: { local?: boolean; remote?: boolean; yes?: boolean }) => {
      const ctx = resolveContext(program.opts());
      const { reindexCommand } = await import('./reindex.js');
      handleResult(await reindexCommand(ctx, opts));
    },
  );

program
  .command('gen')
  .description(
    'Generate a file to stdout (agents.md, claude.md, cursor-rules.md)',
  )
  .argument(
    '<target>',
    'file to generate: agents.md, claude.md, cursor-rules.md',
  )
  .action(async (target: string) => {
    const { genCmd } = await import('./gen.js');
    await genCmd(target);
  });

program
  .command('init')
  .description('Initialize a lat.md directory')
  .argument('[dir]', 'target directory (default: cwd)')
  .action(async (dir?: string) => {
    const { initCmd } = await import('./init.js');
    await initCmd(dir);
  });

program
  .command('hook')
  .description('Handle agent hook events (called by agent hooks, not directly)')
  .argument('<agent>', 'agent name (claude, cursor)')
  .argument(
    '<event>',
    'hook event (claude: UserPromptSubmit|Stop, cursor: stop)',
  )
  .action(async (agent: string, event: string) => {
    const { hookCmd } = await import('./hook.js');
    await hookCmd(agent, event);
  });

program
  .command('mcp')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer();
  });

program
  .command('config')
  .description('Show configuration file path')
  .action(async () => {
    const { getConfigPath } = await import('../config.js');
    const configPath = getConfigPath();
    const exists = existsSync(configPath);
    console.log(`Config file: ${configPath}${exists ? '' : ' (not found)'}`);
  });

await program.parseAsync(checkTargetArgs.args, { from: 'user' });
