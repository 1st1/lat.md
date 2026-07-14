import type { CmdContext, CmdResult, Styler } from '../context.js';
import {
  openDb,
  ensureMeta,
  getStoredModel,
  setStoredModel,
  ensureSectionsSchema,
  dropSections,
  closeDb,
} from '../search/db.js';
import {
  embedderForIndex,
  modelKey,
  ReindexRequiredError,
  EmbeddingAuthError,
  type Embedder,
} from '../search/embedder.js';
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
  progress: IndexProgress | undefined,
  fn: (
    db: Awaited<ReturnType<typeof openDb>>,
    embedder: Embedder,
  ) => Promise<T>,
  forceReindex = false,
): Promise<T> {
  const db = openDb(latDir);

  try {
    await ensureMeta(db);
    const stored = await getStoredModel(db);
    // The stored model is authoritative — no silent backend switch. Throws
    // ReindexRequiredError if the environment can't serve the stored index.
    const embedder = await embedderForIndex(stored);

    if (forceReindex) await dropSections(db);
    await ensureSectionsSchema(db, embedder.dimensions);
    if (!stored || forceReindex) await setStoredModel(db, modelKey(embedder));

    const countResult = await db.execute('SELECT COUNT(*) as n FROM sections');
    const isEmpty = (countResult.rows[0].n as number) === 0;

    progress?.beforeIndex?.(isEmpty);
    const stats = await indexSections(latDir, db, embedder);
    progress?.afterIndex?.(stats, isEmpty);

    return await fn(db, embedder);
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
  limit: number,
  progress?: IndexProgress,
  forceReindex = false,
): Promise<SearchResult> {
  return withDb(
    latDir,
    progress,
    async (db, embedder) => {
      const results = await searchSections(db, query, embedder, limit);
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
    },
    forceReindex,
  );
}

/**
 * Index-only mode (no query). Used by `lat search --reindex`.
 */
export async function runIndex(
  latDir: string,
  progress?: IndexProgress,
  forceReindex = false,
): Promise<void> {
  await withDb(latDir, progress, async () => {}, forceReindex);
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
  const s = ctx.styler;
  const force = !!opts.reindex;
  try {
    if (!query) {
      await runIndex(ctx.latDir, progress, force);
      return { output: '' };
    }

    const result = await runSearch(
      ctx.latDir,
      query,
      opts.limit,
      progress,
      force,
    );

    if (result.matches.length === 0) {
      return { output: 'No results found.' };
    }

    return {
      output:
        formatResultList(
          ctx,
          `Search results for "${query}":`,
          result.matches,
        ) + formatNavHints(ctx),
    };
  } catch (err) {
    // The stored index can't be served in the current environment — never
    // switch backends silently; direct the user to `lat reindex`.
    if (err instanceof ReindexRequiredError) {
      return { output: s.red(err.message), isError: true };
    }
    if (err instanceof EmbeddingAuthError) {
      return {
        output:
          s.red(`LAT_LLM_KEY was rejected by the provider (${err.status}).`) +
          ' Run ' +
          s.cyan('lat reindex') +
          ' to fix the key or switch to the local model.',
        isError: true,
      };
    }
    // Config/key resolution errors (e.g. empty LAT_LLM_KEY_FILE) or other
    // failures — surface the message rather than crashing.
    return { output: (err as Error).message, isError: true };
  }
}
