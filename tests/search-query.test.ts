import { LEXICAL_VERSION } from '../src/search/lexical.js';
vi.mock('node:fs', () => ({ existsSync: () => true }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Section } from '../src/lattice-model.js';

const mocks = vi.hoisted(() => ({
  readManifest: vi.fn(),
  closeDb: vi.fn(),
  embedderForIndex: vi.fn(),
  ensureMeta: vi.fn(),
  ensureSectionsSchema: vi.fn(),
  getStoredModel: vi.fn(),
  openDb: vi.fn(),
  searchSections: vi.fn(),
}));

vi.mock('../src/search/db.js', () => ({
  readManifest: mocks.readManifest,
  closeDb: mocks.closeDb,
  ensureMeta: mocks.ensureMeta,
  ensureSectionsSchema: mocks.ensureSectionsSchema,
  getStoredModel: mocks.getStoredModel,
  openDb: mocks.openDb,
}));

vi.mock('../src/search/embedder.js', () => ({
  ReindexRequiredError: class extends Error {},
  embedderForIndex: mocks.embedderForIndex,
}));

vi.mock('../src/search/search.js', () => ({
  searchSections: mocks.searchSections,
}));

import {
  openIndexedSearchSession,
  resolveSearchMatches,
} from '../src/search/query.js';

const section: Section = {
  id: 'lat.md/guide#Guide',
  heading: 'Guide',
  depth: 1,
  file: 'lat.md/guide',
  filePath: 'lat.md/guide.md',
  children: [],
  startLine: 1,
  endLine: 3,
  firstParagraph: 'A guide.',
};

describe('indexed search sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readManifest.mockReturnValue({ version: 1, file: 'search-test.db' });
    mocks.openDb.mockReturnValue({
      database: 'test',
      execute: vi
        .fn()
        .mockResolvedValue({ rows: [{ value: LEXICAL_VERSION }] }),
    });
    mocks.ensureMeta.mockResolvedValue(undefined);
    mocks.ensureSectionsSchema.mockResolvedValue(undefined);
    mocks.closeDb.mockResolvedValue(undefined);
    mocks.getStoredModel.mockResolvedValue('local:test:1');
    mocks.embedderForIndex.mockResolvedValue({
      name: 'local:test',
      dimensions: 1,
      embed: vi.fn(),
    });
    mocks.searchSections.mockResolvedValue([
      {
        id: section.id,
        file: section.file,
        heading: section.heading,
        content: section.firstParagraph,
        rankScore: 0.8,
      },
      {
        id: 'lat.md/missing#Missing',
        file: 'lat.md/missing',
        heading: 'Missing',
        content: 'Missing from the project snapshot.',
        rankScore: 0.7,
      },
    ]);
  });

  // @lat: [[tests/search#RAG Tests#Reuses an indexed search session]]
  it('reuses one database and embedder across queries', async () => {
    const createSearchEngine = vi.fn();
    const session = await openIndexedSearchSession('/project/lat.md', {
      cacheDir: '/runtime/cache',
      createSearchEngine,
    });

    const results = await session.search('first', 7, 0.4);
    expect(results).toEqual([
      {
        id: section.id,
        file: section.file,
        heading: section.heading,
        content: section.firstParagraph,
        rankScore: 0.8,
      },
      {
        id: 'lat.md/missing#Missing',
        file: 'lat.md/missing',
        heading: 'Missing',
        content: 'Missing from the project snapshot.',
        rankScore: 0.7,
      },
    ]);
    expect(
      resolveSearchMatches(
        results,
        new Map([[section.id.toLowerCase(), section]]),
      ),
    ).toEqual([{ section, reason: 'hybrid match', rankScore: 0.8 }]);
    await session.search('second', 3);
    await session.close();
    await session.close();

    expect(mocks.openDb).toHaveBeenCalledOnce();
    expect(mocks.openDb).toHaveBeenCalledWith(
      '/project/lat.md',
      '/runtime/cache',
      true,
    );
    expect(mocks.embedderForIndex).toHaveBeenCalledOnce();
    expect(mocks.embedderForIndex).toHaveBeenCalledWith(
      'local:test:1',
      '/project/lat.md',
      createSearchEngine,
    );
    expect(mocks.ensureSectionsSchema).not.toHaveBeenCalled();
    expect(mocks.ensureMeta).not.toHaveBeenCalled();
    expect(mocks.searchSections).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'first',
      expect.anything(),
      7,
      0.4,
    );
    expect(mocks.searchSections).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'second',
      expect.anything(),
      3,
      undefined,
    );
    expect(mocks.closeDb).toHaveBeenCalledOnce();
  });

  // @lat: [[tests/search#RAG Tests#Skips an unbuilt search index]]
  it('returns no matches without loading an embedder for an unbuilt index', async () => {
    mocks.getStoredModel.mockResolvedValue(null);
    const session = await openIndexedSearchSession('/project/lat.md');

    await expect(session.search('query', 5)).resolves.toEqual([]);
    await session.close();

    expect(mocks.embedderForIndex).not.toHaveBeenCalled();
    expect(mocks.ensureSectionsSchema).not.toHaveBeenCalled();
    expect(mocks.searchSections).not.toHaveBeenCalled();
    expect(mocks.closeDb).toHaveBeenCalledOnce();
  });
});
