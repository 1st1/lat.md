import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startReplayServer, hasReplayData } from './rag-replay-server.js';
import type { Server } from 'node:http';

const casesDir = join(import.meta.dirname, 'cases');
const cliPath = join(
  import.meta.dirname,
  '..',
  'dist',
  'src',
  'cli',
  'index.js',
);

describe('mcp', () => {
  let client: Client;

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [cliPath, 'mcp'],
      cwd: join(casesDir, 'basic-project'),
    });
    client = new Client({ name: 'test', version: '0.1' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  // @lat: [[tests/mcp#Lists all tools]]
  it('lists all tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'lat_check',
      'lat_expand',
      'lat_locate',
      'lat_refs',
      'lat_search',
      'lat_section',
    ]);
  });

  // @lat: [[tests/mcp#lat_locate finds a section]]
  it('lat_locate finds a section', async () => {
    const result = await client.callTool({
      name: 'lat_locate',
      arguments: { query: 'Testing' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('lat.md/dev-process#Dev Process#Testing');
  });

  // @lat: [[tests/mcp#lat_locate returns message for missing section]]
  it('lat_locate returns message for missing section', async () => {
    const result = await client.callTool({
      name: 'lat_locate',
      arguments: { query: 'nonexistent-section-xyz' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('No sections matching');
  });

  // @lat: [[tests/mcp#lat_expand expands refs]]
  it('lat_expand expands refs', async () => {
    const result = await client.callTool({
      name: 'lat_expand',
      arguments: { text: 'Tell me about [[dev-process#Testing]]' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('<lat-context>');
    expect(text).toContain('dev-process#Testing');
  });

  // @lat: [[tests/mcp#lat_expand passes through text without refs]]
  it('lat_expand passes through text without refs', async () => {
    const result = await client.callTool({
      name: 'lat_expand',
      arguments: { text: 'No refs here' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toBe('No refs here');
  });

  // @lat: [[tests/mcp#lat_section shows section content]]
  it('lat_section shows section content with refs', async () => {
    const result = await client.callTool({
      name: 'lat_section',
      arguments: { query: 'notes#Second Topic' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('lat.md/notes#Notes#Second Topic');
    expect(text).toContain('See [[dev-process#Testing]]');
    expect(text).toContain('This section references:');
    expect(text).toContain('lat.md/dev-process#Dev Process#Testing');
  });

  // @lat: [[tests/mcp#lat_section returns message for missing section]]
  it('lat_section returns message for missing section', async () => {
    const result = await client.callTool({
      name: 'lat_section',
      arguments: { query: 'nonexistent-section-xyz' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('No sections matching');
  });

  // @lat: [[tests/mcp#lat_check reports errors]]
  it('lat_check reports errors', async () => {
    const result = await client.callTool({
      name: 'lat_check',
      arguments: {},
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    // basic-project has no index file, so check should report that
    expect(text).toContain('error');
    expect(result.isError).toBe(true);
  });
});

// --- MCP search via RAG replay ---

const replayDir = join(casesDir, 'rag', 'replay-data');
const canRunSearch = hasReplayData(replayDir);

describe.skipIf(!canRunSearch)('mcp search (rag)', () => {
  let client: Client;
  let server: Server;
  let tmp: string;

  beforeAll(async () => {
    // Start replay server
    const replay = await startReplayServer(replayDir);
    server = replay.server;
    const replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;

    // Copy rag fixture to tmp so .cache doesn't pollute the repo
    tmp = mkdtempSync(join(tmpdir(), 'lat-mcp-rag-'));
    cpSync(join(casesDir, 'rag'), tmp, { recursive: true });

    const transport = new StdioClientTransport({
      command: 'node',
      args: [cliPath, 'mcp'],
      cwd: tmp,
      env: { ...process.env, LAT_LLM_KEY: replayKey },
    });
    client = new Client({ name: 'test', version: '0.1' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    if (server) server.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  // @lat: [[tests/mcp#lat_search finds auth section]]
  it('lat_search finds auth section', async () => {
    const result = await client.callTool({
      name: 'lat_search',
      arguments: { query: 'how do we handle user login and security?' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('Authentication');
  });

  // @lat: [[tests/mcp#lat_search finds performance section]]
  it('lat_search finds performance section', async () => {
    const result = await client.callTool({
      name: 'lat_search',
      arguments: { query: 'what tools do we use to measure response times?' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('Performance');
  });

  // @lat: [[tests/mcp#lat_search works without an API key]]
  it('lat_search works without an API key using local embeddings', async () => {
    // Spin up a separate MCP server without LAT_LLM_KEY and without XDG config
    const transport2 = new StdioClientTransport({
      command: 'node',
      args: [cliPath, 'mcp'],
      cwd: tmp,
      env: { ...process.env, LAT_LLM_KEY: '', XDG_CONFIG_HOME: tmp },
    });
    const client2 = new Client({ name: 'test2', version: '0.1' });
    await client2.connect(transport2);

    const result = await client2.callTool({
      name: 'lat_search',
      arguments: { query: 'anything' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(result.isError).toBeFalsy();
    expect(text).toContain('Search results');

    await client2.close();
  });
});
