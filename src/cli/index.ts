#!/usr/bin/env node

// Suppress deprecation warnings from transitive dependencies unless --verbose
if (!process.argv.includes('--verbose')) {
  process.noDeprecation = true;
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { resolveContext } from './context.js';
import type { CmdResult } from '../context.js';

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

const check = program
  .command('check')
  .description('Validate links and code references')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { checkAllCommand } = await import('./check.js');
    handleResult(await checkAllCommand(ctx));
  });

check
  .command('md')
  .description('Validate wiki links in lat.md markdown files')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { checkMdCommand } = await import('./check.js');
    handleResult(await checkMdCommand(ctx));
  });

check
  .command('code-refs')
  .description('Validate @lat code references and coverage')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { checkCodeRefsCommand } = await import('./check.js');
    handleResult(await checkCodeRefsCommand(ctx));
  });

check
  .command('index')
  .description('Validate directory index files in lat.md')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { checkIndexCommand } = await import('./check.js');
    handleResult(await checkIndexCommand(ctx));
  });

check
  .command('sections')
  .description('Validate section leading paragraphs in lat.md')
  .action(async () => {
    const ctx = resolveContext(program.opts());
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
  .option('--limit <n>', 'max results', '5')
  .action(async (query: string | undefined, opts: { limit: string }) => {
    const ctx = resolveContext(program.opts());
    const { searchCommand, cliProgress } = await import('./search.js');
    const progress = cliProgress(ctx.styler);
    const result = await searchCommand(
      ctx,
      query,
      { limit: parseInt(opts.limit) },
      progress,
    );
    handleResult(result);
  });

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

await program.parseAsync();
