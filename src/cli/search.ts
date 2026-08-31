import { dirname } from 'node:path';
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
import { DEFAULT_SEARCH_THRESHOLD, searchSections } from '../search/search.js';
import type { SectionMatch } from '../lattice-model.js';
import {
  analyzeMarkdownProject,
  commandProjectAnalysis,
  type MarkdownProjectAnalysis,
} from '../project-analysis.js';
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
  project: MarkdownProjectAnalysis,
  fn: (
    db: Awaited<ReturnType<typeof openDb>>,
    embedder: Embedder,
    project: MarkdownProjectAnalysis,
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
    let isEmpty = (countResult.rows[0].n as number) === 0;

    // Legacy cache: a version before the model was recorded left rows behind
    // with no `meta.embedding_model`. Those vectors may be a different backend
    // (and dimension) than the resolved embedder, and `CREATE TABLE IF NOT
    // EXISTS` won't migrate the column width — so drop and rebuild from scratch
    // under the resolved backend rather than querying a mismatched table.
    if (!stored && !isEmpty) {
      await dropSections(db);
      await ensureSectionsSchema(db, embedder.dimensions);
      isEmpty = true;
    }

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
      const stats = await indexSections(
        latDir,
        db,
        embedder,
        undefined,
        project,
      );
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

    return await fn(db, embedder, project);
  } finally {
    await closeDb(db);
  }
}

/** Resolve raw search hits (by id) to full section matches. */
async function resolveMatches(
  project: MarkdownProjectAnalysis,
  results: { id: string; score: number }[],
): Promise<SectionMatch[]> {
  if (results.length === 0) return [];

  return results.flatMap((result) => {
    const section = project.sectionById.get(result.id.toLowerCase());
    return section
      ? [{ section, reason: 'semantic match', score: result.score }]
      : [];
  });
}

/**
 * Run a semantic search across lat.md sections.
 * Handles indexing (with optional progress callback). Returns matched sections.
 *
 * `opts.buildIndex: false` is read-only mode (the UserPromptSubmit hook): search
 * an existing index but never build or update it — so a user's first prompt in a
 * fresh repo isn't blocked by a full local embed pass. Building the index is
 * `lat search` / `lat reindex`. With nothing indexed yet, returns no matches
 * without even loading the embedder to embed the query.
 */
export async function runSearch(
  latDir: string,
  query: string,
  limit: number,
  progress?: IndexProgress,
  opts?: {
    buildIndex?: boolean;
    project?: MarkdownProjectAnalysis;
    threshold?: number;
  },
): Promise<SearchResult> {
  if (opts?.buildIndex === false) {
    const db = openDb(latDir);
    try {
      await ensureMeta(db);
      const stored = await getStoredModel(db);
      // Never built (or a legacy pre-versioning cache) — leave building to
      // `lat search`; don't load the embedder just to embed the query.
      if (stored === null) return { query, matches: [] };
      const embedder = await embedderForIndex(stored, latDir);
      await ensureSectionsSchema(db, embedder.dimensions);
      const results = await searchSections(
        db,
        query,
        embedder,
        limit,
        opts.threshold,
      );
      const project =
        opts.project ??
        (await analyzeMarkdownProject(latDir, dirname(latDir), {
          executor: 'auto',
        }));
      return { query, matches: await resolveMatches(project, results) };
    } finally {
      await closeDb(db);
    }
  }

  const project =
    opts?.project ??
    (await analyzeMarkdownProject(latDir, dirname(latDir), {
      executor: 'auto',
    }));
  return withDb(latDir, progress, project, async (db, embedder, analyzed) => {
    const results = await searchSections(
      db,
      query,
      embedder,
      limit,
      opts?.threshold,
    );
    return { query, matches: await resolveMatches(analyzed, results) };
  });
}

/**
 * Index-only mode (no query) — builds the index on first use. Rebuilding is
 * `lat reindex`, not a flag here.
 */
export async function runIndex(
  latDir: string,
  progress?: IndexProgress,
  analyzedProject?: MarkdownProjectAnalysis,
): Promise<void> {
  const project =
    analyzedProject ??
    (await analyzeMarkdownProject(latDir, dirname(latDir), {
      executor: 'auto',
    }));
  await withDb(latDir, progress, project, async () => {});
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
  opts: { limit: number; debug?: boolean; threshold?: number },
  progress?: IndexProgress,
): Promise<CmdResult> {
  const s = ctx.styler;
  try {
    if (!query) {
      await runIndex(ctx.latDir, progress, await commandProjectAnalysis(ctx));
      return { output: '' };
    }

    const project = await commandProjectAnalysis(ctx);
    const result = await runSearch(ctx.latDir, query, opts.limit, progress, {
      project,
      threshold: opts.threshold ?? DEFAULT_SEARCH_THRESHOLD,
    });

    if (result.matches.length === 0) {
      return { output: 'No results found.' };
    }

    return {
      output:
        formatResultList(
          ctx,
          `Search results for "${query}":`,
          result.matches,
          { showScores: opts.debug },
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
