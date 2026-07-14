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
import { getLlmKey } from '../config.js';
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
): Promise<T> {
  const db = openDb(latDir);

  try {
    await ensureMeta(db);
    const stored = await getStoredModel(db);
    // The stored model is authoritative — no silent backend switch. Throws
    // ReindexRequiredError if the environment can't serve the stored index.
    // Rebuilding / switching backends is `lat reindex`, never `lat search`.
    const embedder = await embedderForIndex(stored, latDir);

    await ensureSectionsSchema(db, embedder.dimensions);

    const countResult = await db.execute('SELECT COUNT(*) as n FROM sections');
    const isEmpty = (countResult.rows[0].n as number) === 0;

    // If the repo is pinned to local but a key is set, say so — otherwise it
    // looks like the key is being silently ignored.
    if (isEmpty && embedder.name.startsWith('local:') && process.stderr.isTTY) {
      let hasKey = false;
      try {
        hasKey = !!getLlmKey();
      } catch {
        /* key source misconfigured — irrelevant, we're local */
      }
      if (hasKey) {
        process.stderr.write(
          'This repo is configured for local embeddings; ignoring LAT_LLM_KEY.\n',
        );
      }
    }

    progress?.beforeIndex?.(isEmpty);
    try {
      const stats = await indexSections(latDir, db, embedder);
      // Pin the backend only after a successful index, so a failed build never
      // leaves the repo wrongly pinned to an empty index.
      if (!stored) await setStoredModel(db, modelKey(embedder));
      progress?.afterIndex?.(stats, isEmpty);
    } catch (err) {
      // Failed fresh build → drop the half-created table so the next run is
      // truly fresh (re-resolves the backend cleanly) rather than stuck.
      if (!stored) await dropSections(db);
      throw err;
    }

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
): Promise<SearchResult> {
  return withDb(latDir, progress, async (db, embedder) => {
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
  });
}

/**
 * Index-only mode (no query) — builds the index on first use. Rebuilding is
 * `lat reindex`, not a flag here.
 */
export async function runIndex(
  latDir: string,
  progress?: IndexProgress,
): Promise<void> {
  await withDb(latDir, progress, async () => {});
}

export function cliProgress(s: Styler): IndexProgress {
  return {
    beforeIndex(isEmpty) {
      if (isEmpty) {
        process.stderr.write(s.dim('Building index...'));
      }
    },
    afterIndex(stats, isEmpty) {
      if (isEmpty) {
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
  opts: { limit: number },
  progress?: IndexProgress,
): Promise<CmdResult> {
  const s = ctx.styler;
  try {
    if (!query) {
      await runIndex(ctx.latDir, progress);
      return { output: '' };
    }

    const result = await runSearch(ctx.latDir, query, opts.limit, progress);

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
