import readline from 'node:readline/promises';
import type { CmdContext, CmdResult } from '../context.js';
import {
  openDb,
  ensureMeta,
  setStoredModel,
  ensureSectionsSchema,
  dropSections,
  closeDb,
} from '../search/db.js';
import {
  embedderFromEnv,
  localEmbedder,
  modelKey,
  EmbeddingAuthError,
  type Embedder,
} from '../search/embedder.js';
import { getLlmKey, getRepoEmbedding, setRepoEmbedding } from '../config.js';
import { indexSections } from '../search/index.js';
import { commandProjectAnalysis } from '../project-analysis.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

async function confirmUseLocal(
  ctx: CmdContext,
  status: number,
  assumeYes: boolean,
): Promise<boolean> {
  const s = ctx.styler;
  process.stderr.write(
    s.yellow(`LAT_LLM_KEY was rejected by the provider (${status}).`) + '\n',
  );
  if (assumeYes) return true;
  // Can't prompt when not attached to a terminal (agents, CI, MCP).
  if (ctx.mode !== 'cli' || !process.stdin.isTTY) return false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const ans = (
    await rl.question('Use local offline embeddings instead? [Y/n] ')
  )
    .trim()
    .toLowerCase();
  rl.close();
  return ans === '' || ans === 'y' || ans === 'yes';
}

/**
 * Rebuild the embedding index. Honors the durable per-repo backend preference:
 * a repo pinned to local rebuilds local and ignores the key. `--local` forces
 * local; `--remote` forces re-resolving from the key (the escape hatch back to
 * hosted); a bare run on an unpinned repo decides from the env. If a key is set
 * but rejected, offers to switch to local (`--yes` answers non-interactively).
 */
export async function reindexCommand(
  ctx: CmdContext,
  opts: { local?: boolean; remote?: boolean; yes?: boolean },
): Promise<CmdResult> {
  const s = ctx.styler;

  let key: string | undefined;
  try {
    key = getLlmKey();
  } catch (err) {
    return { output: (err as Error).message, isError: true };
  }

  if (opts.remote && !key) {
    return {
      output: s.red('--remote requires LAT_LLM_KEY to be set.'),
      isError: true,
    };
  }

  const pinnedLocal = getRepoEmbedding(ctx.latDir) === 'local';

  let embedder: Embedder;
  if (opts.local || (pinnedLocal && !opts.remote)) {
    // Explicit --local, or the repo is already pinned to local: use local and
    // ignore the key. Say so when a key is present, so it's not a silent drop.
    if (!opts.local && key) {
      process.stderr.write(
        s.dim(
          'Local embeddings configured for this repo; ignoring LAT_LLM_KEY.\n',
        ),
      );
    }
    embedder = await localEmbedder();
  } else if (!key) {
    embedder = await localEmbedder();
  } else {
    // Resolve from the env key (bare + unpinned, or explicit --remote). Verify
    // it with a tiny probe first, so an invalid key doesn't wipe a working index.
    try {
      const remote = await embedderFromEnv();
      await remote.embed(['lat reindex: verifying embedding key']);
      embedder = remote;
    } catch (err) {
      // A malformed/unsupported key prefix throws from embedderFromEnv (a plain
      // Error, not EmbeddingAuthError) — surface it cleanly instead of crashing.
      if (!(err instanceof EmbeddingAuthError)) {
        return { output: (err as Error).message, isError: true };
      }
      if (!(await confirmUseLocal(ctx, err.status, !!opts.yes))) {
        return {
          output:
            ' Fix the key, or re-run ' +
            s.cyan('lat reindex --local') +
            ' to switch to the offline model.',
          isError: true,
        };
      }
      embedder = await localEmbedder();
    }
  }

  const db = openDb(ctx.latDir);
  const interactive = ctx.mode === 'cli' && !!process.stderr.isTTY;
  try {
    await ensureMeta(db);
    await dropSections(db);
    await ensureSectionsSchema(db, embedder.dimensions);

    const label = `Reindexing with ${embedder.name}`;
    // Interactive terminals get a live progress line driven per embed-chunk
    // (frame + done/total). Elsewhere (agents, CI, MCP) a single plain line
    // keeps logs clean. Progress is event-driven, not timer-based, so it stays
    // accurate even though the local WASM forward pass is synchronous.
    let frame = 0;
    const onProgress = interactive
      ? (done: number, total: number) => {
          const f = SPINNER[frame++ % SPINNER.length];
          process.stderr.write(
            `\r\x1b[K${f} ${s.dim(`${label} — ${done}/${total}`)}`,
          );
        }
      : undefined;

    if (interactive)
      process.stderr.write(`${SPINNER[0]} ${s.dim(label + '…')}`);
    else process.stderr.write(s.dim(label + '…\n'));

    let stats;
    try {
      stats = await indexSections(
        ctx.latDir,
        db,
        embedder,
        onProgress,
        await commandProjectAnalysis(ctx),
      );
      // Pin the backend only after a successful build, so a failed reindex never
      // records a model that doesn't match a completed index.
      await setStoredModel(db, modelKey(embedder));
    } catch (err) {
      // Build failed: drop the half-built table so the DB is left clean. `meta`
      // still holds the prior model, so the next run rebuilds it consistently.
      await dropSections(db);
      throw err;
    } finally {
      if (interactive) process.stderr.write('\r\x1b[K'); // clear the progress line
    }

    // Durably remember the choice so it survives a `.cache` wipe / fresh clone:
    // local pins local (ignore the key thereafter); remote clears the pin so the
    // env decides again.
    setRepoEmbedding(
      ctx.latDir,
      embedder.name.startsWith('local:') ? 'local' : null,
    );

    return {
      output:
        s.green(`Reindexed ${stats.added} sections`) +
        ` using ${s.cyan(embedder.name)}.`,
    };
  } finally {
    await closeDb(db);
  }
}
