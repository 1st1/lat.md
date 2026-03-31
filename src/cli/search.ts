import type { CmdContext, CmdResult, Styler } from '../context.js';
import { openDb, ensureSchema, closeDb } from '../search/db.js';
import type { EmbeddingProvider } from '../search/provider.js';
import { indexSections, type IndexStats } from '../search/index.js';
import { searchSections } from '../search/search.js';
import {
  loadAllSections,
  flattenSections,
  type SectionMatch,
} from '../lattice.js';
import { formatResultList, formatNavHints } from '../format.js';

export type SearchResult = {
  query: string;
  matches: SectionMatch[];
};

export type IndexProgress = {
  /** Called before indexing starts. `isEmpty` is true on first run. */
  beforeIndex?: (isEmpty: boolean) => void;
  /** Called after indexing completes with stats. */
  afterIndex?: (stats: IndexStats, isEmpty: boolean) => void;
};

async function withDb<T>(
  latDir: string,
  provider: EmbeddingProvider,
  key: string | undefined,
  progress: IndexProgress | undefined,
  fn: (db: Awaited<ReturnType<typeof openDb>>) => Promise<T>,
): Promise<T> {
  const db = openDb(latDir);

  try {
    await ensureSchema(db, provider.dimensions);

    const countResult = await db.execute('SELECT COUNT(*) as n FROM sections');
    const isEmpty = (countResult.rows[0].n as number) === 0;

    progress?.beforeIndex?.(isEmpty);
    const stats = await indexSections(latDir, db, provider, key);
    progress?.afterIndex?.(stats, isEmpty);

    return await fn(db);
  } finally {
    await closeDb(db);
  }
}

/**
 * Run a semantic search across lat.md sections.
 * Handles indexing (with optional progress callback). Returns matched sections.
 */
export async function runSearch(
  latDir: string,
  query: string,
  provider: EmbeddingProvider,
  key: string | undefined,
  limit: number,
  progress?: IndexProgress,
): Promise<SearchResult> {
  return withDb(latDir, provider, key, progress, async (db) => {
    const results = await searchSections(db, query, provider, key, limit);
    if (results.length === 0) {
      return { query, matches: [] };
    }

    const allSections = await loadAllSections(latDir);
    const flat = flattenSections(allSections);
    const byId = new Map(flat.map((s) => [s.id, s]));

    const matches = results
      .map((r) => byId.get(r.id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({ section: s, reason: 'semantic match' }));

    return { query, matches };
  });
}

/**
 * Index-only mode (no query). Used by `lat search --reindex`.
 */
export async function runIndex(
  latDir: string,
  provider: EmbeddingProvider,
  key: string | undefined,
  progress?: IndexProgress,
): Promise<void> {
  await withDb(latDir, provider, key, progress, async () => {});
}

export function cliProgress(reindex: boolean, s: Styler): IndexProgress {
  return {
    beforeIndex(isEmpty) {
      if (isEmpty || reindex) {
        const label = reindex ? 'Re-indexing' : 'Building index';
        process.stderr.write(s.dim(`${label}...`));
      }
    },
    afterIndex(stats, isEmpty) {
      if (isEmpty || reindex) {
        process.stderr.write(
          s.dim(
            ` done (${stats.added} added, ${stats.updated} updated, ${stats.removed} removed)\n`,
          ),
        );
      } else if (stats.added + stats.updated + stats.removed > 0) {
        process.stderr.write(
          s.dim(
            `Index updated: ${stats.added} added, ${stats.updated} updated, ${stats.removed} removed\n`,
          ),
        );
      }
    },
  };
}

export async function searchCommand(
  ctx: CmdContext,
  query: string | undefined,
  opts: { limit: number; reindex?: boolean },
  progress?: IndexProgress,
): Promise<CmdResult> {
  const { getLlmKey, readConfig, getConfigPath } = await import('../config.js');
  const { detectProvider } = await import('../search/provider.js');

  const config = readConfig();
  let key: string | undefined;
  try {
    key = getLlmKey();
  } catch (err) {
    return { output: (err as Error).message, isError: true };
  }

  let provider: Awaited<ReturnType<typeof detectProvider>>;
  try {
    provider = detectProvider(key, config);
  } catch (err) {
    const s = ctx.styler;
    return {
      output:
        s.red((err as Error).message) +
        ' Provide a key via LAT_LLM_KEY, LAT_LLM_KEY_FILE, LAT_LLM_KEY_HELPER, or run ' +
        s.cyan('lat init') +
        (ctx.mode === 'cli'
          ? ' to save one in ' + s.dim(getConfigPath())
          : '') +
        '.',
      isError: true,
    };
  }

  if (!query) {
    await runIndex(ctx.latDir, provider, key, progress);
    return { output: '' };
  }

  const result = await runSearch(
    ctx.latDir,
    query,
    provider,
    key,
    opts.limit,
    progress,
  );

  if (result.matches.length === 0) {
    return { output: 'No results found.' };
  }

  return {
    output:
      formatResultList(ctx, `Search results for "${query}":`, result.matches) +
      formatNavHints(ctx),
  };
}
