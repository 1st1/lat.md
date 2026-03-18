/**
 * Embedding replay server with two modes:
 *
 * - **Replay** (default): serves cached vectors from replay-data/
 * - **Capture** (_LAT_TEST_CAPTURE_EMBEDDINGS=1): proxies to real API,
 *   records all text→vector mappings, writes replay-data/ on close
 *
 * Both modes expose an OpenAI-compatible POST /embeddings endpoint.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { ApiProvider } from '../src/search/provider.js';

type Manifest = {
  dimensions: number;
  vectors: Record<string, number>;
};

function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// --- Shared types ---

type ReplayServerResult = {
  server: Server;
  port: number;
  url: string;
  /** Call to flush captured data (capture mode only) */
  flush: () => void;
};

// --- Replay mode ---

function readVector(buf: Buffer, index: number, dimensions: number): number[] {
  const vec: number[] = [];
  const offset = index * dimensions * 4;
  for (let i = 0; i < dimensions; i++) {
    vec.push(buf.readFloatLE(offset + i * 4));
  }
  return vec;
}

function createReplayHandler(replayDir: string) {
  const manifest: Manifest = JSON.parse(
    readFileSync(join(replayDir, 'manifest.json'), 'utf-8'),
  );
  const buf = Buffer.from(readFileSync(join(replayDir, 'vectors.bin')));

  return (input: string[]) => {
    const data = [];
    for (let i = 0; i < input.length; i++) {
      const hash = textHash(input[i]);
      const vecIndex = manifest.vectors[hash];
      if (vecIndex === undefined) {
        return {
          error: `No cached vector for hash ${hash} (text: "${input[i].slice(0, 80)}..."). Re-run: pnpm cook-test-rag`,
        };
      }
      data.push({
        object: 'embedding',
        index: i,
        embedding: readVector(buf, vecIndex, manifest.dimensions),
      });
    }
    return { data };
  };
}

// --- Capture mode ---

function createCaptureHandler(
  replayDir: string,
  realProvider: ApiProvider,
  realKey: string,
) {
  const captured = new Map<string, number[]>();

  const handler = async (input: string[]) => {
    // Forward to real API
    const resp = await fetch(`${realProvider.apiBase}/embeddings`, {
      method: 'POST',
      headers: realProvider.headers(realKey),
      body: JSON.stringify({ model: realProvider.model, input }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      return {
        error: `Real API error (${resp.status}): ${body.slice(0, 200)}`,
      };
    }

    const json = (await resp.json()) as {
      data: { embedding: number[]; index: number }[];
    };
    const sorted = json.data.sort((a, b) => a.index - b.index);

    // Record each text→vector
    for (let i = 0; i < input.length; i++) {
      const hash = textHash(input[i]);
      captured.set(hash, sorted[i].embedding);
    }

    return {
      data: sorted.map((item, i) => ({
        object: 'embedding',
        index: i,
        embedding: item.embedding,
      })),
    };
  };

  const flush = () => {
    mkdirSync(replayDir, { recursive: true });

    const entries = [...captured.entries()];
    if (entries.length === 0) return;

    const dimensions = entries[0][1].length;
    const manifest: Manifest = { dimensions, vectors: {} };

    const buf = Buffer.alloc(entries.length * dimensions * 4);
    for (let i = 0; i < entries.length; i++) {
      const [hash, vec] = entries[i];
      manifest.vectors[hash] = i;
      for (let j = 0; j < dimensions; j++) {
        buf.writeFloatLE(vec[j], (i * dimensions + j) * 4);
      }
    }

    writeFileSync(
      join(replayDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    writeFileSync(join(replayDir, 'vectors.bin'), buf);
    console.log(
      `Captured ${entries.length} vectors (${buf.length} bytes) to ${replayDir}`,
    );
  };

  return { handler, flush };
}

// --- Public API ---

export function startReplayServer(
  replayDir: string,
  opts?: { capture: true; provider: ApiProvider; key: string },
): Promise<ReplayServerResult> {
  let handler: (input: string[]) => any;
  let flush = () => {};

  if (opts?.capture) {
    const cap = createCaptureHandler(replayDir, opts.provider, opts.key);
    handler = cap.handler;
    flush = cap.flush;
  } else {
    const replay = createReplayHandler(replayDir);
    handler = replay;
  }

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/embeddings') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          try {
            const { input } = JSON.parse(body) as { input: string[] };
            const result = await handler(input);

            if (result.error) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: result.error }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ object: 'list', data: result.data }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        flush,
      });
    });
  });
}

export function hasReplayData(replayDir: string): boolean {
  return existsSync(join(replayDir, 'manifest.json'));
}
