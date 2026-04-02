import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectProvider,
  type EmbeddingProvider,
} from '../src/search/provider.js';
import { openDb, ensureSchema, closeDb } from '../src/search/db.js';
import { indexSections } from '../src/search/index.js';
import { searchSections } from '../src/search/search.js';
import { startReplayServer, hasReplayData } from './rag-replay-server.js';
import type { Client } from '@libsql/client';
import type { Server } from 'node:http';

// --- Unit tests (always run) ---

// @lat: [[search#Provider Detection]]
describe('detectProvider', () => {
  it('detects OpenAI key', () => {
    const p = detectProvider('sk-abc123');
    expect(p.name).toBe('openai');
  });

  it('detects Vercel key', () => {
    const p = detectProvider('vck_abc123');
    expect(p.name).toBe('vercel');
  });

  it('detects GitHub classic PAT', () => {
    const p = detectProvider('ghp_abc123');
    expect(p.name).toBe('github');
    expect(p.apiBase).toBe('https://models.github.ai/inference');
    expect(p.model).toBe('openai/text-embedding-3-small');
    expect(p.dimensions).toBe(1536);
    expect(p.errorHint).toBeDefined();
  });

  it('detects GitHub fine-grained PAT', () => {
    const p = detectProvider('github_pat_abc123');
    expect(p.name).toBe('github');
    expect(p.apiBase).toBe('https://models.github.ai/inference');
    expect(p.model).toBe('openai/text-embedding-3-small');
    expect(p.dimensions).toBe(1536);
  });

  it('detects GitHub OAuth token (gh CLI)', () => {
    const p = detectProvider('gho_abc123');
    expect(p.name).toBe('github');
    expect(p.apiBase).toBe('https://models.github.ai/inference');
  });

  it('rejects Anthropic key with helpful message', () => {
    expect(() => detectProvider('sk-ant-abc123')).toThrow(/Anthropic/);
    expect(() => detectProvider('sk-ant-abc123')).toThrow(/ghp_/);
  });

  it('rejects unknown key with provider list', () => {
    expect(() => detectProvider('xyz_abc123')).toThrow(/Unrecognized/);
    expect(() => detectProvider('xyz_abc123')).toThrow(/GitHub/);
  });

  it('rejects GitHub App token (ghs_)', () => {
    expect(() => detectProvider('ghs_abc123')).toThrow(/Unrecognized/);
  });
});

// --- errorHint tests ---

import { embed } from '../src/search/embeddings.js';

describe('embed errorHint', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('appends errorHint to API error when provider has one', async () => {
    const mockProvider: EmbeddingProvider = {
      name: 'test',
      apiBase: 'http://localhost:99999',
      model: 'test-model',
      dimensions: 1536,
      headers: () => ({ 'Content-Type': 'application/json' }),
      errorHint: 'Check your token permissions.',
    };

    globalThis.fetch = (async () =>
      new Response('Unauthorized', { status: 401 })) as typeof fetch;

    await expect(embed(['hello'], mockProvider, 'fake-key')).rejects.toThrow(
      /Check your token permissions/,
    );
  });

  it('does not append hint when provider has no errorHint', async () => {
    const mockProvider: EmbeddingProvider = {
      name: 'test',
      apiBase: 'http://localhost:99999',
      model: 'test-model',
      dimensions: 1536,
      headers: () => ({ 'Content-Type': 'application/json' }),
    };

    globalThis.fetch = (async () =>
      new Response('Unauthorized', { status: 401 })) as typeof fetch;

    await expect(embed(['hello'], mockProvider, 'fake-key')).rejects.toThrow(
      /Embedding API error \(401\): Unauthorized$/,
    );
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
  let provider: EmbeddingProvider;
  let replayKey: string;
  let flushCapture: () => void;

  beforeAll(async () => {
    if (capturing) {
      // Capture mode: proxy to real API, record vectors
      const realKey = process.env.LAT_LLM_KEY;
      if (!realKey) throw new Error('LAT_LLM_KEY must be set in capture mode');
      const realProvider = detectProvider(realKey);

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
