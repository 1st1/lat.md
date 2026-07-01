import type { CmdContext, CmdResult, Styler } from '../context.js';
import { openDb, ensureSchema, closeDb } from '../search/db.js';
import { detectProvider } from '../search/provider.js';
import { resolveSchema } from '../search/schema.js';
import { indexSections, type IndexStats } from '../search/index.js';
import { searchSections } from '../search/search.js';
import {
  loadAllSections,
  flattenSections,
  type SectionMatch,
} from '../lattice.js';
import { formatResultList, formatNavHints } from '../format.js';
import { getLlmProviderOptions } from '../config.js';

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
  key: string,
  progress: IndexProgress | undefined,
  fn: (
    db: Awaited<ReturnType<typeof openDb>>,
    provider: ReturnType<typeof detectProvider>,
  ) => Promise<T>,
): Promise<T> {
  const provider = detectProvider(key, getLlmProviderOptions());
  const db = openDb(latDir);

  try {
    const { dimensions, configChanged } = await resolveSchema(
      db,
      provider,
      key,
    );
    if (configChanged) {
      // Embedding provider/model changed since the last run — the fixed-size
      // vector column can't hold vectors of a different dimension, so drop
      // and rebuild from scratch.
      await db.execute('DROP TABLE IF EXISTS sections');
    }
    await ensureSchema(db, dimensions);

    const countResult = await db.execute('SELECT COUNT(*) as n FROM sections');
    const isEmpty = (countResult.rows[0].n as number) === 0;

    progress?.beforeIndex?.(isEmpty);
    const stats = await indexSections(latDir, db, provider, key);
    progress?.afterIndex?.(stats, isEmpty);

    return await fn(db, provider);
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
  key: string,
  limit: number,
  progress?: IndexProgress,
): Promise<SearchResult> {
  return withDb(latDir, key, progress, async (db, provider) => {
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
  key: string,
  progress?: IndexProgress,
): Promise<void> {
  await withDb(latDir, key, progress, async () => {});
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
  const { getLlmKey, getConfigPath } = await import('../config.js');
  let key: string | undefined;
  try {
    key = getLlmKey();
  } catch (err) {
    return { output: (err as Error).message, isError: true };
  }
  if (!key) {
    const s = ctx.styler;
    return {
      output:
        s.red('No API key configured.') +
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
    try {
      await runIndex(ctx.latDir, key, progress);
    } catch (err) {
      return { output: (err as Error).message, isError: true };
    }
    return { output: '' };
  }

  let result: SearchResult;
  try {
    result = await runSearch(ctx.latDir, query, key, opts.limit, progress);
  } catch (err) {
    return { output: (err as Error).message, isError: true };
  }

  if (result.matches.length === 0) {
    return { output: 'No results found.' };
  }

  return {
    output:
      formatResultList(ctx, `Search results for "${query}":`, result.matches) +
      formatNavHints(ctx),
  };
}
