import { createInterface } from 'node:readline/promises';
import type { CmdContext, CmdResult } from '../context.js';
import {
  addCanonicalExternalSource,
  describeExternalSources,
  inferExternalFetchUrl,
  loadExternalSources,
  normalizeExternalRepoUrl,
  parseExternalTarget,
  resolveExternalCommit,
  type ExternalSourceDescription,
  type ExternalStrategy,
} from '../external-sources.js';
import { selectMenu } from './select-menu.js';

export type ExternalAddOptions = {
  commit?: string;
  prefix?: string;
  strategy?: string;
  fetchUrl?: string;
};

function shellArg(value: string): string {
  return /^[a-zA-Z0-9_./:@=-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function formatDescription(value: ExternalSourceDescription): string {
  const lines = [
    `${value.handle}`,
    `  Repository: ${value.repo}`,
    `  Commit: ${value.effectiveCommit}${value.effectiveCommit !== value.canonicalCommit ? ` (canonical: ${value.canonicalCommit})` : ''}`,
    `  Strategy: ${value.effectiveStrategy}${value.effectiveStrategy !== value.strategy ? ` (canonical: ${value.strategy})` : ''}`,
    `  Prefix: ${value.prefix || '(none)'}`,
    `  Cache: ${value.cache ? `${value.cache.strategy} @ ${value.cache.commit}` : '(empty)'}`,
  ];
  if (value.fetchUrl) lines.push(`  Fetch URL: ${value.fetchUrl}`);
  if (value.localPath) lines.push(`  Local path: ${value.localPath}`);
  if (value.localError) lines.push(`  Local error: ${value.localError}`);
  lines.push('  Suggested checkout:');
  for (const command of value.checkout) {
    lines.push(
      `    ${[command.command, ...command.args].map(shellArg).join(' ')}`,
    );
  }
  return lines.join('\n');
}

export async function externalListCommand(
  ctx: CmdContext,
  json = false,
): Promise<CmdResult> {
  const snapshot = await loadExternalSources(ctx.latDir, ctx.projectRoot);
  if (!snapshot.validCanonical) {
    return {
      output: snapshot.errors
        .map((error) => `${error.file}: ${error.message}`)
        .join('\n'),
      isError: true,
    };
  }
  const descriptions = describeExternalSources(ctx.latDir, snapshot);
  return {
    output: json
      ? JSON.stringify(descriptions, null, 2)
      : descriptions.length
        ? descriptions.map(formatDescription).join('\n\n')
        : 'No external sources configured',
  };
}

export async function externalShowCommand(
  ctx: CmdContext,
  query: string,
  json = false,
): Promise<CmdResult> {
  const snapshot = await loadExternalSources(ctx.latDir, ctx.projectRoot);
  const colon = query.indexOf(':');
  const handle = colon === -1 ? query : query.slice(0, colon);
  const source = describeExternalSources(ctx.latDir, snapshot).find(
    (item) => item.handle === handle,
  );
  if (!source) {
    return {
      output: `External source "${handle}" is not configured`,
      isError: true,
    };
  }
  let target: ReturnType<typeof parseExternalTarget> = null;
  if (colon !== -1) {
    try {
      target = parseExternalTarget(query, snapshot);
    } catch (error) {
      return { output: (error as Error).message, isError: true };
    }
  }
  const value = target
    ? {
        ...source,
        target: target.identity,
        repositoryPath: target.repositoryPath,
      }
    : source;
  return {
    output: json
      ? JSON.stringify(value, null, 2)
      : formatDescription(source) +
        (target
          ? `\n  Target: ${target.identity}\n  Repository path: ${target.repositoryPath}`
          : ''),
  };
}

async function question(
  rl: ReturnType<typeof createInterface>,
  label: string,
  current?: string,
): Promise<string> {
  if (current) return current;
  const answer = (await rl.question(`${label}: `)).trim();
  if (!answer) throw new Error(`${label} is required`);
  return answer;
}

export async function externalAddCommand(
  ctx: CmdContext,
  handleValue: string | undefined,
  repoValue: string | undefined,
  options: ExternalAddOptions,
): Promise<CmdResult> {
  const interactive = !!process.stdin.isTTY;
  if (
    !interactive &&
    (!handleValue || !repoValue || !options.commit || !options.strategy)
  ) {
    return {
      output:
        'Non-interactive use requires handle, repo, --commit, and --strategy',
      isError: true,
    };
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const handle = await question(rl, 'Handle', handleValue);
    const repo = normalizeExternalRepoUrl(
      await question(rl, 'Repository', repoValue),
    );
    const ref = await question(rl, 'Commit or ref', options.commit);
    const prefix =
      options.prefix ??
      (interactive ? (await rl.question('Prefix (optional): ')).trim() : '');
    let strategy = options.strategy;
    if (!strategy && interactive) {
      const inferred = inferExternalFetchUrl(repo);
      strategy =
        (await selectMenu(
          inferred
            ? [
                {
                  label: 'Fetch individual files (recommended)',
                  value: 'fetch',
                },
                { label: 'Use a Lat-managed checkout', value: 'checkout' },
              ]
            : [
                {
                  label: 'Use a Lat-managed checkout (recommended)',
                  value: 'checkout',
                },
                { label: 'Fetch individual files', value: 'fetch' },
              ],
          'How should Lat read this source?',
        )) ?? undefined;
    }
    if (strategy !== 'fetch' && strategy !== 'checkout') {
      return { output: 'strategy must be fetch or checkout', isError: true };
    }
    let fetchUrl = options.fetchUrl;
    if (
      strategy === 'fetch' &&
      !fetchUrl &&
      !inferExternalFetchUrl(repo) &&
      interactive
    ) {
      fetchUrl = await question(rl, 'Fetch URL template');
    }
    const commit = await resolveExternalCommit(repo, ref);
    if (interactive) {
      const confirmation = (
        await rl.question(
          `Add ${handle} at ${commit} using ${strategy}? [Y/n] `,
        )
      )
        .trim()
        .toLowerCase();
      if (confirmation === 'n' || confirmation === 'no')
        return { output: 'Aborted' };
    }
    await addCanonicalExternalSource(ctx.latDir, {
      handle,
      repo,
      commit,
      ...(prefix ? { prefix } : {}),
      strategy: strategy as ExternalStrategy,
      ...(fetchUrl ? { fetchUrl } : {}),
    });
    return { output: `Added external source ${handle} at ${commit}` };
  } catch (error) {
    return { output: (error as Error).message, isError: true };
  } finally {
    rl.close();
  }
}
