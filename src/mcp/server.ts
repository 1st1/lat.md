import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { dirname } from 'node:path';
import { findLatticeDir } from '../lattice.js';
import { plainStyler, type CmdContext, type CmdResult } from '../context.js';
import { locateCommand } from '../cli/locate.js';
import { sectionCommand } from '../cli/section.js';
import { searchCommand } from '../cli/search.js';
import { expandCommand } from '../cli/expand.js';
import {
  checkAllCommand,
  checkCodeRefsCommand,
  checkIndexCommand,
  checkMdCommand,
  checkSectionsCommand,
} from '../cli/check.js';
import { refsCommand, type Scope } from '../cli/refs.js';

function toMcp(result: CmdResult) {
  const content = [{ type: 'text' as const, text: result.output }];
  return result.isError ? { content, isError: true } : { content };
}

export async function startMcpServer(): Promise<void> {
  const latDir = findLatticeDir();
  if (!latDir) {
    process.stderr.write('No lat.md directory found\n');
    process.exit(1);
  }
  const projectRoot = dirname(latDir);
  const ctx: CmdContext = {
    latDir,
    projectRoot,
    styler: plainStyler,
    mode: 'mcp',
  };

  const server = new McpServer({
    name: 'lat',
    version: '1.0.0',
  });

  server.tool(
    'lat_locate',
    'Find sections by name (exact, fuzzy, subsequence matching)',
    { query: z.string().describe('Section name or id to search for') },
    async ({ query }) => toMcp(await locateCommand(ctx, query)),
  );

  server.tool(
    'lat_section',
    'Show a section with its content, outgoing wiki link targets, and incoming references',
    {
      query: z.string().describe('Section id to look up (short or full form)'),
    },
    async ({ query }) => toMcp(await sectionCommand(ctx, query)),
  );

  server.tool(
    'lat_search',
    'Semantic search across lat.md sections using embeddings',
    {
      query: z.string().describe('Search query in natural language'),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe('Max results (default 5)'),
    },
    async ({ query, limit }) =>
      toMcp(await searchCommand(ctx, query, { limit })),
  );

  server.tool(
    'lat_expand',
    'Expand [[refs]] in text to resolved lat.md section paths with context',
    { text: z.string().describe('Text containing [[refs]] to expand') },
    async ({ text: input }) => toMcp(await expandCommand(ctx, input)),
  );

  server.tool(
    'lat_check',
    'Validate wiki links, code references, directory indexes, and/or section structure in lat.md',
    {
      scope: z
        .enum(['all', 'md', 'code-refs', 'index', 'sections'])
        .optional()
        .default('all')
        .describe(
          'What to check: all (default), md, code-refs, index, or sections',
        ),
    },
    async ({ scope }: { scope: string }) => {
      switch (scope) {
        case 'md':
          return toMcp(await checkMdCommand(ctx));
        case 'code-refs':
          return toMcp(await checkCodeRefsCommand(ctx));
        case 'index':
          return toMcp(await checkIndexCommand(ctx));
        case 'sections':
          return toMcp(await checkSectionsCommand(ctx));
        default:
          return toMcp(await checkAllCommand(ctx));
      }
    },
  );

  server.tool(
    'lat_refs',
    'Find sections that reference a given section via wiki links or @lat code comments',
    {
      query: z.string().describe('Section id to find references for'),
      scope: z
        .enum(['md', 'code', 'md+code'])
        .optional()
        .default('md+code')
        .describe('Where to search: md, code, or md+code'),
    },
    async ({ query, scope }) =>
      toMcp(await refsCommand(ctx, query, scope as Scope)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
