import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { rmDirBestEffort } from './util.js';
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
import { runSearch } from '../src/cli/search.js';
import { formatResultList } from '../src/format.js';
import { plainStyler, type CmdContext } from '../src/context.js';
import type { Section } from '../src/lattice-model.js';
import { startReplayServer, hasReplayData } from './rag-replay-server.js';
import type { Client } from '@libsql/client';
import type { Server } from 'node:http';

// Passthrough spy on `readFile` so the indexing test below can count how many
// times each lat.md file is read. Every other test sees the real implementation.
const { readFileSpy } = vi.hoisted(() => ({ readFileSpy: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  readFileSpy.mockImplementation(actual.readFile);
  return { ...actual, readFile: readFileSpy };
});

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
    if (latDir) rmDirBestEffort(join(latDir, '..'));
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
    expect(Number.isFinite(results[0].score)).toBe(true);
    expect(results[0].score).toBeGreaterThanOrEqual(results.at(-1)!.score);
  });

  // @lat: [[search#RAG Tests#Filters results below the similarity threshold]]
  it('filters results below the similarity threshold', async () => {
    const query = 'how do we handle user login and security?';
    const results = await searchSections(db, query, embedder);
    const threshold = (results[0].score + results[1].score) / 2;
    const filtered = await searchSections(db, query, embedder, 5, threshold);

    expect(filtered.map((result) => result.id)).toEqual([results[0].id]);
    expect(filtered[0].score).toBeGreaterThanOrEqual(threshold);
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

describe('search result formatting', () => {
  const ctx: CmdContext = {
    latDir: '/project/lat.md',
    projectRoot: '/project',
    styler: plainStyler,
    mode: 'cli',
  };
  const section: Section = {
    id: 'lat.md/architecture#Authentication',
    heading: 'Authentication',
    depth: 2,
    file: 'lat.md/architecture',
    filePath: 'lat.md/architecture.md',
    children: [],
    startLine: 3,
    endLine: 8,
    firstParagraph: 'Authentication uses signed sessions.',
  };
  const matches = [{ section, reason: 'semantic match', score: 0.8123456789 }];

  // @lat: [[search#RAG Tests#Debug output includes similarity scores]]
  it('shows scores only when debug output is requested', () => {
    const normal = formatResultList(ctx, 'Results:', matches);
    const debug = formatResultList(ctx, 'Results:', matches, {
      showScores: true,
    });

    expect(normal).toContain('(semantic match)');
    expect(normal).not.toContain('score:');
    expect(debug).toContain('(semantic match, score: 0.812346)');
  });
});

// --- Legacy cache upgrade: rebuild a pre-versioning index ---
//
// A `.cache` built by a version that never recorded `meta.embedding_model` has
// rows but no model. Resolving to a different backend (here local 384-dim vs a
// stale remote 1536-dim table) must drop + rebuild, not query the mismatch.

describe('search (rag, legacy cache upgrade)', () => {
  // @lat: [[search#RAG Tests#Rebuilds a legacy cache with no recorded model]]
  it('rebuilds a legacy cache that has rows but no recorded model', async () => {
    const latDir = copyFixture();

    // Seed a populated 1536-dim table (as an old remote build would leave) with
    // no meta.embedding_model recorded.
    const seed = openDb(latDir);
    await ensureMeta(seed);
    await ensureSectionsSchema(seed, 1536);
    const bogus = JSON.stringify(new Array(1536).fill(0.1));
    await seed.execute({
      sql: `INSERT INTO sections (id, file, heading, content, content_hash, embedding, updated_at)
            VALUES (?, ?, ?, ?, ?, vector(?), ?)`,
      args: ['stale#Old', 'stale.md', 'Old', 'stale', 'deadbeef', bogus, 0],
    });
    await closeDb(seed);

    // Clear the env so the rebuild resolves to the local 384-dim model — the
    // dimension mismatch that previously threw a raw libsql error at query time.
    const savedKeys = [
      'LAT_LLM_KEY',
      'LAT_LLM_KEY_FILE',
      'LAT_LLM_KEY_HELPER',
      'XDG_CONFIG_HOME',
    ] as const;
    const saved = Object.fromEntries(savedKeys.map((k) => [k, process.env[k]]));
    const cfg = mkdtempSync(join(tmpdir(), 'lat-cfg-'));
    process.env.LAT_LLM_KEY = '';
    process.env.LAT_LLM_KEY_FILE = '';
    process.env.LAT_LLM_KEY_HELPER = '';
    process.env.XDG_CONFIG_HOME = cfg;

    try {
      const result = await runSearch(
        latDir,
        'how do we handle user login and security?',
        5,
      );
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].section.id).toContain('Authentication');
    } finally {
      for (const k of savedKeys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      rmDirBestEffort(cfg);
      rmDirBestEffort(join(latDir, '..'));
    }
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
    if (latDir) rmDirBestEffort(join(latDir, '..'));
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

// --- Indexing reads each file once ---
//
// Section text is sliced out of its file by line range. Reading the file per
// section is O(sections x file size): a 3.5 MB tests.md holding 12k sections
// was re-read 12k times on every search (~95 s before the query even ran).

describe('search (rag, file reads)', () => {
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
    if (latDir) rmDirBestEffort(join(latDir, '..'));
  });

  // @lat: [[search#RAG Tests#Reads each file once when indexing]]
  it('reads each file once when indexing', async () => {
    readFileSpy.mockClear();
    const stats = await indexSections(latDir, db, embedder);
    expect(stats.added).toBe(9);

    const readsPerFile = new Map<string, number>();
    for (const [path] of readFileSpy.mock.calls) {
      const file = String(path);
      if (!file.endsWith('.md')) continue;
      readsPerFile.set(file, (readsPerFile.get(file) ?? 0) + 1);
    }
    expect(readsPerFile.size).toBe(2);
    // The parser reads each file once; slicing section text must reuse a
    // single read per file, never one per section (5 and 4 in this fixture).
    for (const [file, reads] of readsPerFile) {
      expect(reads, `${file} read ${reads} times`).toBeLessThanOrEqual(2);
    }
  });
});
