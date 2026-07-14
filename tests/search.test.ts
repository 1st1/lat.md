import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProvider, createEmbedder, type Embedder } from '@lat.md/embed';
import minilm from '@lat.md/embed-minilm-fp16';
import {
  openDb,
  ensureMeta,
  ensureSectionsSchema,
  closeDb,
} from '../src/search/db.js';
import { indexSections } from '../src/search/index.js';
import { searchSections } from '../src/search/search.js';
import { startReplayServer, hasReplayData } from './rag-replay-server.js';
import type { Client } from '@libsql/client';
import type { Server } from 'node:http';

// --- Unit tests: provider detection (now lives in @lat.md/embed) ---

// @lat: [[search#Provider Detection]]
describe('detectProvider', () => {
  it('detects OpenAI key', () => {
    expect(detectProvider('sk-abc123').name).toBe('openai');
  });
  it('detects Vercel key', () => {
    expect(detectProvider('vck_abc123').name).toBe('vercel');
  });
  it('rejects Anthropic key with helpful message', () => {
    expect(() => detectProvider('sk-ant-abc123')).toThrow(/Anthropic/);
  });
  it('rejects unknown key', () => {
    expect(() => detectProvider('xyz_abc123')).toThrow(/Unrecognized/);
  });
});

// --- RAG functional tests: local MiniLM engine (deterministic, always run) ---
//
// The local backend produces identical vectors for identical text, so these run
// the real WASM engine directly — no API key, no network, no replay recording.

function copyFixture(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'lat-rag-'));
  const latDir = join(tmp, 'lat.md');
  cpSync(join(import.meta.dirname, 'cases', 'rag', 'lat.md'), latDir, {
    recursive: true,
  });
  return latDir;
}

describe('search (rag, local)', () => {
  let latDir: string;
  let db: Client;
  let embedder: Embedder;

  beforeAll(async () => {
    embedder = await createEmbedder({ model: minilm });
    latDir = copyFixture();
    db = openDb(latDir);
    await ensureMeta(db);
    await ensureSectionsSchema(db, embedder.dimensions);
  });

  afterAll(async () => {
    if (db) await closeDb(db);
    if (latDir) rmSync(join(latDir, '..'), { recursive: true, force: true });
  });

  // @lat: [[search#RAG Tests#Indexes all sections]]
  it('indexes all sections', async () => {
    const stats = await indexSections(latDir, db, embedder);
    expect(stats.added).toBe(9);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.unchanged).toBe(0);
  });

  // @lat: [[search#RAG Tests#Finds auth section for login query]]
  it('finds auth section for login query', async () => {
    const results = await searchSections(
      db,
      'how do we handle user login and security?',
      embedder,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Authentication');
  });

  // @lat: [[search#RAG Tests#Finds performance section for latency query]]
  it('finds performance section for latency query', async () => {
    const results = await searchSections(
      db,
      'what tools do we use to measure response times?',
      embedder,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Performance');
  });

  // @lat: [[search#RAG Tests#Deterministic embeddings]]
  it('produces identical vectors for identical text', async () => {
    const [a] = await embedder.embed(['stable input']);
    const [b] = await embedder.embed(['stable input']);
    expect(a).toEqual(b);
  });

  // @lat: [[search#RAG Tests#Incremental index skips unchanged sections]]
  it('incremental index skips unchanged sections', async () => {
    const stats = await indexSections(latDir, db, embedder);
    expect(stats.unchanged).toBe(9);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
  });

  // @lat: [[search#RAG Tests#Detects deleted sections when file is removed]]
  it('detects deleted sections when file is removed', async () => {
    rmSync(join(latDir, 'testing.md'));
    const stats = await indexSections(latDir, db, embedder);
    expect(stats.removed).toBe(4); // testing + unit + integration + performance
    expect(stats.unchanged).toBe(5); // architecture sections remain
  });
});

// --- Hosted backend: replay-based test (supplementary, runs if data present) ---
//
// Exercises the remote fetch backend via a local OpenAI-compatible replay server,
// so the hosted code path stays covered without a live key. Re-cook: pnpm cook-test-rag

const capturing = !!process.env._LAT_TEST_CAPTURE_EMBEDDINGS;
const replayDir = join(import.meta.dirname, 'cases', 'rag', 'replay-data');
const canRunHosted = capturing || hasReplayData(replayDir);

describe.skipIf(!canRunHosted)('search (rag, hosted replay)', () => {
  let latDir: string;
  let db: Client;
  let server: Server;
  let embedder: Embedder;
  let flushCapture: () => void;

  beforeAll(async () => {
    const opts = capturing
      ? (() => {
          const realKey = process.env.LAT_LLM_KEY;
          if (!realKey)
            throw new Error('LAT_LLM_KEY must be set in capture mode');
          return {
            capture: true as const,
            provider: detectProvider(realKey),
            key: realKey,
          };
        })()
      : undefined;
    const replay = await startReplayServer(replayDir, opts);
    server = replay.server;
    flushCapture = replay.flush;
    embedder = await createEmbedder({
      key: `REPLAY_LAT_LLM_KEY::${replay.url}`,
    });

    latDir = copyFixture();
    db = openDb(latDir);
    await ensureMeta(db);
    await ensureSectionsSchema(db, embedder.dimensions);
  });

  afterAll(async () => {
    if (capturing) flushCapture();
    if (db) await closeDb(db);
    if (server) server.close();
    if (latDir) rmSync(join(latDir, '..'), { recursive: true, force: true });
  });

  it('indexes and finds the auth section via the hosted backend', async () => {
    const stats = await indexSections(latDir, db, embedder);
    expect(stats.added).toBe(9);
    const results = await searchSections(
      db,
      'how do we handle user login and security?',
      embedder,
    );
    expect(results[0].id).toContain('Authentication');
  });
});
