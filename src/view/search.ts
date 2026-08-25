import { dirname, relative, resolve } from 'node:path';
import type { SectionMatch } from '../lattice.js';
import { toPosix } from '../walk.js';
import type { ViewSearchResponse, ViewSearchResult } from './protocol.js';

const VIEW_SEARCH_LIMIT = 10;

export type ViewSearch = (query: string) => Promise<ViewSearchResponse>;

export type ViewSearchDependencies = {
  runIndex: (latDir: string) => Promise<void>;
  runSearch: (
    latDir: string,
    query: string,
    limit: number,
    options: { buildIndex: false },
  ) => Promise<{ query: string; matches: SectionMatch[] }>;
};

const defaultDependencies: ViewSearchDependencies = {
  async runIndex(latDir) {
    const { runIndex } = await import('../cli/search.js');
    await runIndex(latDir);
  },
  async runSearch(latDir, query, limit, options) {
    const { runSearch } = await import('../cli/search.js');
    return runSearch(latDir, query, limit, undefined, options);
  },
};

function documentUrl(path: string, headingId?: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const fragment = headingId ? `#${encodeURIComponent(headingId)}` : '';
  return `/docs/${encodedPath}${fragment}`;
}

function viewSearchResult(
  latDir: string,
  match: SectionMatch,
): ViewSearchResult {
  const section = match.section;
  const projectRoot = dirname(latDir);
  const path = toPosix(
    relative(latDir, resolve(projectRoot, section.filePath)),
  );
  const fileBreadcrumbs = path.replace(/\.md$/i, '').split('/');
  return {
    sectionId: section.id,
    title: section.heading,
    path,
    breadcrumbs: [...fileBreadcrumbs, ...section.id.split('#').slice(1)],
    description: section.firstParagraph,
    url: documentUrl(path, section.githubSlug),
  };
}

/** Create the lazily indexed semantic search service used by `lat view`. */
export function createViewSearch(
  latDir: string,
  dependencies: ViewSearchDependencies = defaultDependencies,
  getGeneration: () => number = () => 0,
): ViewSearch {
  let indexReady: Promise<void> | null = null;
  let indexedGeneration = -1;

  const prepareIndex = async (): Promise<void> => {
    while (indexedGeneration < getGeneration() || indexedGeneration < 0) {
      if (!indexReady) {
        const generation = getGeneration();
        indexReady = dependencies
          .runIndex(latDir)
          .then(() => {
            indexedGeneration = Math.max(indexedGeneration, generation);
          })
          .finally(() => {
            indexReady = null;
          });
      }
      await indexReady;
    }
  };

  return async (rawQuery) => {
    const query = rawQuery.trim();
    if (!query) return { query: '', results: [] };

    await prepareIndex();
    const search = await dependencies.runSearch(
      latDir,
      query,
      VIEW_SEARCH_LIMIT,
      { buildIndex: false },
    );
    return {
      query: search.query,
      results: search.matches.map((match) => viewSearchResult(latDir, match)),
    };
  };
}
