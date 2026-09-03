import type { Section } from '../lattice-model.js';
import type { CreateSearchEngine } from '../search/embedder.js';
import {
  openIndexedSearchSession,
  resolveSearchMatches,
  type IndexedSearchSession,
} from '../search/query.js';
import type { ViewSearchResponse } from './protocol.js';
import { viewSearchResult } from './search-result.js';

const VIEW_SEARCH_LIMIT = 10;

export type PreindexedViewSearchDependencies = {
  openSearchSession: (
    latDir: string,
    options: {
      cacheDir?: string;
      createSearchEngine?: CreateSearchEngine;
    },
  ) => Promise<IndexedSearchSession>;
};

export type PreindexedViewSearch = ((
  query: string,
) => Promise<ViewSearchResponse>) & {
  close: () => Promise<void>;
};

/** Serve a built search index without importing indexing or Markdown parsers. */
export async function createPreindexedViewSearch(
  latDir: string,
  cacheDir: string,
  sections: readonly Section[],
  documentPaths: ReadonlyMap<string, string>,
  dependencies: PreindexedViewSearchDependencies = {
    openSearchSession: openIndexedSearchSession,
  },
  createSearchEngine?: CreateSearchEngine,
): Promise<PreindexedViewSearch> {
  const sectionById = new Map(
    sections.map((section) => [section.id.toLowerCase(), section]),
  );
  const session = await dependencies.openSearchSession(latDir, {
    cacheDir,
    createSearchEngine,
  });
  const search = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return { query: '', results: [] };
    const results = await session.search(query, VIEW_SEARCH_LIMIT);
    return {
      query,
      results: resolveSearchMatches(results, sectionById).map((match) =>
        viewSearchResult(latDir, match, documentPaths),
      ),
    };
  };
  search.close = session.close;
  return search;
}
