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
import { checkAllCommand } from '../cli/check.js';
import { refsCommand, type Scope } from '../cli/refs.js';
import { externalListCommand, externalShowCommand } from '../cli/external.js';

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
  const requestContext = (): CmdContext => ({ ...ctx, analysis: undefined });

  const server = new McpServer({
    name: 'lat',
    version: '1.0.0',
  });

  server.tool(
    'lat_locate',
    'Find sections by name (exact, fuzzy, subsequence matching)',
    { query: z.string().describe('Section name or id to search for') },
    async ({ query }) => toMcp(await locateCommand(requestContext(), query)),
  );

  server.tool(
    'lat_section',
    'Show a local section or exact external target with content and references',
    {
      query: z
        .string()
        .describe('Local section id or exact handle:path#fragment target'),
    },
    async ({ query }) => toMcp(await sectionCommand(requestContext(), query)),
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
      toMcp(await searchCommand(requestContext(), query, { limit })),
  );

  server.tool(
    'lat_expand',
    'Expand [[refs]] in text to resolved lat.md section paths with context',
    { text: z.string().describe('Text containing [[refs]] to expand') },
    async ({ text: input }) =>
      toMcp(await expandCommand(requestContext(), input)),
  );

  server.tool(
    'lat_check',
    'Run full lat.md validation: links, code references, indexes, and section structure',
    {},
    async () => toMcp(await checkAllCommand(requestContext())),
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
      toMcp(await refsCommand(requestContext(), query, scope as Scope)),
  );

  server.tool(
    'lat_external_list',
    'List configured external sources without fetching or changing caches',
    {},
    async () => toMcp(await externalListCommand(ctx, true)),
  );

  server.tool(
    'lat_external_show',
    'Show one configured external source or exact external target without fetching it',
    {
      source: z.string().describe('External source handle or exact target'),
    },
    async ({ source }) => toMcp(await externalShowCommand(ctx, source, true)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
