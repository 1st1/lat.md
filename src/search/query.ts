import { LEXICAL_VERSION } from './lexical.js';
import { ReindexRequiredError } from './embedder.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from './db.js';
import type { Section, SectionMatch } from '../lattice-model.js';
import { closeDb, getStoredModel, openDb } from './db.js';
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
    minSimilarity?: number,
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
            reason: 'hybrid match',
            rankScore: result.rankScore,
            semanticSimilarity: result.semanticSimilarity,
            lexicalScore: result.lexicalScore,
            semanticRank: result.semanticRank,
            lexicalRank: result.lexicalRank,
            evidence: result.evidence,
            diagnostics: result.diagnostics,
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
  const cacheDir = options.cacheDir ?? join(latDir, '.cache');
  if (!existsSync(cacheDir) || !readManifest(cacheDir))
    return { search: async () => [], close: async () => {} };
  const db = openDb(latDir, options.cacheDir);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await closeDb(db);
  };
  try {
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
    const lexicalVersion = (
      await db.execute("SELECT value FROM meta WHERE key='lexical_version'")
    ).rows[0]?.value;
    if (lexicalVersion !== LEXICAL_VERSION)
      throw new ReindexRequiredError(
        'Search lexical index changed; run lat search to update it.',
      );
    const embedder = await embedderForIndex(
      stored,
      latDir,
      options.createSearchEngine,
    );
    return {
      async search(query, limit, minSimilarity) {
        if (closed) throw new Error('Search session is closed');
        return searchSections(db, query, embedder, limit, minSimilarity);
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
  options: { cacheDir?: string; minSimilarity?: number } = {},
): Promise<IndexedSearchResult> {
  const session = await openIndexedSearchSession(latDir, options);
  try {
    const results = await session.search(query, limit, options.minSimilarity);
    return {
      query,
      matches: resolveSearchMatches(results, sectionById),
    };
  } finally {
    await session.close();
  }
}
