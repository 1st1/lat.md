import type { Section, SectionMatch } from '../lattice-model.js';
import {
  closeDb,
  ensureMeta,
  ensureSectionsSchema,
  getStoredModel,
  openDb,
} from './db.js';
import { embedderForIndex, type CreateSearchEngine } from './embedder.js';
import { searchSections } from './search.js';

export type IndexedSearchResult = {
  query: string;
  matches: SectionMatch[];
};

export type IndexedSearchSession = {
  search: (
    query: string,
    limit: number,
    threshold?: number,
  ) => Promise<IndexedSearchResult>;
  close: () => Promise<void>;
};

/** Open one reusable database and embedder for a sequence of index queries. */
export async function openIndexedSearchSession(
  latDir: string,
  sectionById: ReadonlyMap<string, Section>,
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
        search: async (query) => {
          if (closed) throw new Error('Search session is closed');
          return { query, matches: [] };
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
        const results = await searchSections(
          db,
          query,
          embedder,
          limit,
          threshold,
        );
        return {
          query,
          matches: results.flatMap((result) => {
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
          }),
        };
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
  const session = await openIndexedSearchSession(latDir, sectionById, options);
  try {
    return await session.search(query, limit, options.threshold);
  } finally {
    await session.close();
  }
}
