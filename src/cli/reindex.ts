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
import { getLlmKey } from '../config.js';
import { indexSections } from '../search/index.js';

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
 * Rebuild the embedding index, re-deciding the backend from the environment.
 * This is the only place the env var re-selects the backend. If a key is set
 * but rejected, offers to switch to the local model (then future `lat search`
 * runs use local, ignoring the key). `--local` forces local; `--yes` answers
 * the prompt non-interactively.
 */
export async function reindexCommand(
  ctx: CmdContext,
  opts: { local?: boolean; yes?: boolean },
): Promise<CmdResult> {
  const s = ctx.styler;

  let key: string | undefined;
  try {
    key = getLlmKey();
  } catch (err) {
    return { output: (err as Error).message, isError: true };
  }

  let embedder: Embedder;
  if (opts.local || !key) {
    embedder = await localEmbedder();
  } else {
    // Key present — verify it with a tiny probe before committing to a remote
    // rebuild, so an invalid key doesn't wipe a working index.
    const remote = await embedderFromEnv();
    try {
      await remote.embed(['lat reindex: verifying embedding key']);
      embedder = remote;
    } catch (err) {
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
  try {
    await ensureMeta(db);
    await dropSections(db);
    await ensureSectionsSchema(db, embedder.dimensions);
    await setStoredModel(db, modelKey(embedder));

    process.stderr.write(s.dim(`Reindexing with ${embedder.name}...`));
    const stats = await indexSections(ctx.latDir, db, embedder);
    process.stderr.write(s.dim(` done\n`));

    return {
      output:
        s.green(`Reindexed ${stats.added} sections`) +
        ` using ${s.cyan(embedder.name)}.`,
    };
  } finally {
    await closeDb(db);
  }
}
