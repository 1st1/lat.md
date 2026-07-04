import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Client } from '@libsql/client';
import { openDb, closeDb } from '../src/search/db.js';
import { resolveSchema } from '../src/search/schema.js';
import type { EmbeddingProvider } from '../src/search/provider.js';

/** Minimal OpenAI-compatible /embeddings stub returning fixed-length vectors. */
function startStubServer(
  dimensions: number,
): Promise<{ server: Server; url: string; callCount: () => number }> {
  let calls = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        calls++;
        const { input } = JSON.parse(body) as { input: string[] };
        const data = input.map((_, i) => ({
          object: 'embedding',
          index: i,
          embedding: new Array(dimensions).fill(0.1),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
        callCount: () => calls,
      });
    });
  });
}

function makeProvider(
  apiBase: string,
  model: string,
  dimensions?: number,
): EmbeddingProvider {
  return {
    name: 'stub',
    apiBase,
    model,
    dimensions,
    headers: () => ({ 'Content-Type': 'application/json' }),
  };
}

describe('resolveSchema', () => {
  let tmp: string;
  let db: Client;
  let server: Server;
  let url: string;
  let callCount: () => number;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'lat-schema-'));
    db = openDb(tmp);
    const stub = await startStubServer(768);
    server = stub.server;
    url = stub.url;
    callCount = stub.callCount;
  });

  afterEach(async () => {
    await closeDb(db);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // libsql's local-file client can hold the vectors.db file handle open
      // briefly after close() on Windows (EBUSY). This is just cleanup of an
      // OS temp directory, so a leftover file here doesn't affect test
      // correctness — ignore it rather than fail the test.
    }
  });

  // @lat: [[search#Dimension Resolution#Probes and caches an unknown dimension]]
  it('probes an unknown dimension and caches it', async () => {
    const provider = makeProvider(url, 'custom-model');
    const result = await resolveSchema(db, provider, 'key');
    expect(result.dimensions).toBe(768);
    expect(result.configChanged).toBe(false);
    expect(callCount()).toBe(1);
  });

  // @lat: [[search#Dimension Resolution#Reuses cached dimension on repeat calls]]
  it('reuses the cached dimension without re-probing', async () => {
    const provider = makeProvider(url, 'custom-model');
    await resolveSchema(db, provider, 'key');
    expect(callCount()).toBe(1);

    const result = await resolveSchema(db, provider, 'key');
    expect(result.dimensions).toBe(768);
    expect(result.configChanged).toBe(false);
    expect(callCount()).toBe(1); // no additional probe
  });

  // @lat: [[search#Dimension Resolution#Detects provider or model changes]]
  it('reports configChanged when the provider signature changes', async () => {
    const providerA = makeProvider(url, 'model-a');
    await resolveSchema(db, providerA, 'key');

    const providerB = makeProvider(url, 'model-b');
    const result = await resolveSchema(db, providerB, 'key');
    expect(result.configChanged).toBe(true);
  });

  it('does not probe when dimensions are statically known', async () => {
    const provider = makeProvider(url, 'known-model', 1536);
    const result = await resolveSchema(db, provider, 'key');
    expect(result.dimensions).toBe(1536);
    expect(callCount()).toBe(0);
  });

  it('does not report a change on the very first run', async () => {
    const provider = makeProvider(url, 'custom-model');
    const result = await resolveSchema(db, provider, 'key');
    expect(result.configChanged).toBe(false);
  });
});
