import type { Section, SectionMatch } from '../lattice-model.js';
import {
  closeDb,
  ensureMeta,
  ensureSectionsSchema,
  getStoredModel,
  openDb,
} from './db.js';
import { embedderForIndex, type CreateSearchEngine } from './embedder.js';
import { searchSections, type SearchResult } from './search.js';

export type IndexedSearchResult = {
  query: string;
  matches: SectionMatch[];
};

export type IndexedSearchSession = {
  search: (
    query: string,
    limit: number,
    threshold?: number,
  ) => Promise<SearchResult[]>;
  close: () => Promise<void>;
};

/** Resolve scored index rows against one already-analyzed project snapshot. */
export function resolveSearchMatches(
  results: readonly SearchResult[],
  sectionById: ReadonlyMap<string, Section>,
): SectionMatch[] {
  return results.flatMap((result) => {
    const section = sectionById.get(result.id.toLowerCase());
    return section
      ? [
          {
            section,
            reason: 'semantic match',
            score: result.score,
          } satisfies SectionMatch,
        ]
      : [];
  });
}

/** Open one reusable database and embedder for a sequence of index queries. */
export async function openIndexedSearchSession(
  latDir: string,
  options: {
    cacheDir?: string;
    createSearchEngine?: CreateSearchEngine;
  } = {},
): Promise<IndexedSearchSession> {
  const db = openDb(latDir, options.cacheDir);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await closeDb(db);
  };
  try {
    await ensureMeta(db);
    const stored = await getStoredModel(db);
    if (stored === null) {
      return {
        search: async () => {
          if (closed) throw new Error('Search session is closed');
          return [];
        },
        close,
      };
    }
    const embedder = await embedderForIndex(
      stored,
      latDir,
      options.createSearchEngine,
    );
    await ensureSectionsSchema(db, embedder.dimensions);
    return {
      async search(query, limit, threshold) {
        if (closed) throw new Error('Search session is closed');
        return searchSections(db, query, embedder, limit, threshold);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Query a finished index and resolve its ids from precomputed section data. */
export async function searchIndexedSections(
  latDir: string,
  query: string,
  limit: number,
  sectionById: ReadonlyMap<string, Section>,
  options: { cacheDir?: string; threshold?: number } = {},
): Promise<IndexedSearchResult> {
  const session = await openIndexedSearchSession(latDir, options);
  try {
    const results = await session.search(query, limit, options.threshold);
    return {
      query,
      matches: resolveSearchMatches(results, sectionById),
    };
  } finally {
    await session.close();
  }
}
