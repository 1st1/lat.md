import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProvider } from '../src/search/provider.js';
import { openDb, ensureSchema, closeDb } from '../src/search/db.js';
import { indexSections } from '../src/search/index.js';
import { searchSections } from '../src/search/search.js';
import { startReplayServer, hasReplayData } from './rag-replay-server.js';
import type { Client } from '@libsql/client';
import type { Server } from 'node:http';

// --- Unit tests (always run) ---

// @lat: [[search#Provider Detection]]
describe('detectProvider', () => {
  it('returns local provider when no key given', () => {
    const p = detectProvider();
    expect(p.kind).toBe('local');
    expect(p.name).toBe('local');
    expect(p.dimensions).toBe(384);
  });

  it('detects OpenAI key', () => {
    const p = detectProvider('sk-abc123');
    expect(p.name).toBe('openai');
  });

  it('detects Vercel key', () => {
    const p = detectProvider('vck_abc123');
    expect(p.name).toBe('vercel');
  });

  it('rejects Anthropic key with helpful message', () => {
    expect(() => detectProvider('sk-ant-abc123')).toThrow(/Anthropic/);
  });

  it('rejects unknown key', () => {
    expect(() => detectProvider('xyz_abc123')).toThrow(/Unrecognized/);
  });
});

// --- Schema tests ---

// @lat: [[search#Schema Dimension Mismatch]]
describe('ensureSchema dimension mismatch', () => {
  let tmp: string;
  let db: Client;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lat-dim-'));
  });

  afterAll(async () => {
    if (db) await closeDb(db);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('rebuilds table and logs diagnostic when dimensions change', async () => {
    db = openDb(tmp);

    // Create with 1536 dimensions
    await ensureSchema(db, 1536);
    await db.execute({
      sql: `INSERT INTO sections
            (id, file, heading, content, content_hash, embedding, updated_at)
            VALUES (?, ?, ?, ?, ?, vector(?), ?)`,
      args: [
        'test-id',
        'test.md',
        'Test',
        'content',
        'hash123',
        JSON.stringify(new Array(1536).fill(0)),
        Date.now(),
      ],
    });
    const before = await db.execute('SELECT COUNT(*) as n FROM sections');
    expect(before.rows[0].n).toBe(1);

    // Re-init with 384 dimensions — should drop and recreate
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await ensureSchema(db, 384);

    const calls = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();

    const after = await db.execute('SELECT COUNT(*) as n FROM sections');
    expect(after.rows[0].n).toBe(0);

    // Verify new dimension is stored in meta
    const meta = await db.execute(
      "SELECT value FROM meta WHERE key = 'embedding_dimensions'",
    );
    expect(meta.rows[0].value).toBe('384');

    // Verify diagnostic was printed to stderr
    expect(calls.some((m) => m.includes('dimensions changed'))).toBe(true);
  });
});

// --- Local embedding tests (requires @huggingface/transformers) ---

let hasTransformers = false;
try {
  await import('@huggingface/transformers');
  hasTransformers = true;
} catch {}

// @lat: [[search#Local Embedding]]
describe.skipIf(!hasTransformers)('local embedding', () => {
  it('produces normalized vectors with correct dimensions', async () => {
    const { embedLocal } = await import('../src/search/local.js');
    const model = 'Xenova/all-MiniLM-L6-v2';

    const [vec] = await embedLocal(['hello world'], model);
    expect(vec.length).toBe(384);

    // Mean-pooled + normalized vectors should have unit length.
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 2);
  });

  it('ranks semantically similar texts closer', async () => {
    const { embedLocal } = await import('../src/search/local.js');
    const model = 'Xenova/all-MiniLM-L6-v2';

    const [a, b, c] = await embedLocal(
      [
        'how to authenticate users',
        'user login and security',
        'banana split recipe',
      ],
      model,
    );

    const dot = (x: number[], y: number[]) =>
      x.reduce((s, v, i) => s + v * y[i], 0);

    // auth↔login should be more similar than auth↔banana
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });
});

// --- RAG functional tests ---
//
// Two modes:
// - Normal (default): replays cached vectors from tests/cases/rag/replay-data/
// - Capture (_LAT_TEST_CAPTURE_EMBEDDINGS=1): proxies to real API via LAT_LLM_KEY,
//   records vectors to replay-data/, then runs assertions against live results
//
// To re-cook: pnpm cook-test-rag

const capturing = !!process.env._LAT_TEST_CAPTURE_EMBEDDINGS;
const replayDir = join(import.meta.dirname, 'cases', 'rag', 'replay-data');
const canRun = capturing || hasReplayData(replayDir);

describe.skipIf(!canRun)('search (rag)', () => {
  let tmp: string;
  let latDir: string;
  let db: Client;
  let server: Server;
  let provider: ReturnType<typeof detectProvider>;
  let replayKey: string;
  let flushCapture: () => void;

  beforeAll(async () => {
    if (capturing) {
      // Capture mode: proxy to real API, record vectors
      const realKey = process.env.LAT_LLM_KEY;
      if (!realKey) throw new Error('LAT_LLM_KEY must be set in capture mode');
      const realProvider = detectProvider(realKey);
      if (realProvider.kind !== 'api')
        throw new Error('Capture mode requires an API provider');

      const replay = await startReplayServer(replayDir, {
        capture: true,
        provider: realProvider,
        key: realKey,
      });
      server = replay.server;
      flushCapture = replay.flush;
      replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;
      provider = detectProvider(replayKey);
    } else {
      // Replay mode: serve cached vectors
      const replay = await startReplayServer(replayDir);
      server = replay.server;
      flushCapture = replay.flush;
      replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;
      provider = detectProvider(replayKey);
    }

    // Copy fixture to tmp so .cache doesn't pollute the repo
    tmp = mkdtempSync(join(tmpdir(), 'lat-rag-'));
    latDir = join(tmp, 'lat.md');
    cpSync(join(import.meta.dirname, 'cases', 'rag', 'lat.md'), latDir, {
      recursive: true,
    });

    db = openDb(latDir);
    await ensureSchema(db, provider.dimensions);
  });

  afterAll(async () => {
    if (capturing) flushCapture();
    if (db) await closeDb(db);
    if (server) server.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  // @lat: [[search#RAG Replay Tests#Indexes all sections]]
  it('indexes all sections', async () => {
    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.added).toBe(9);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.unchanged).toBe(0);
  });

  // @lat: [[search#RAG Replay Tests#Finds auth section for login query]]
  it('finds auth section for login query', async () => {
    const results = await searchSections(
      db,
      'how do we handle user login and security?',
      provider,
      replayKey,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Authentication');
  });

  // @lat: [[search#RAG Replay Tests#Finds performance section for latency query]]
  it('finds performance section for latency query', async () => {
    const results = await searchSections(
      db,
      'what tools do we use to measure response times?',
      provider,
      replayKey,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Performance');
  });

  // @lat: [[search#RAG Replay Tests#Incremental index skips unchanged sections]]
  it('incremental index skips unchanged sections', async () => {
    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.unchanged).toBe(9);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
  });

  // @lat: [[search#RAG Replay Tests#Detects deleted sections when file is removed]]
  it('detects deleted sections when file is removed', async () => {
    rmSync(join(latDir, 'testing.md'));

    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.removed).toBe(4); // testing + unit + integration + performance
    expect(stats.unchanged).toBe(5); // architecture sections remain
  });
});
