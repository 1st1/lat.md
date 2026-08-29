import { createInterface } from 'node:readline/promises';
import type { CmdContext, CmdResult } from '../context.js';
import {
  addCanonicalExternalSource,
  describeExternalSources,
  inferExternalFetchUrl,
  loadExternalSources,
  normalizeExternalDefaultFileExtension,
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
  defaultFileExtension?: string;
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
    `  Default file extension: ${value.defaultFileExtension || '(none)'}`,
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
  let rl: ReturnType<typeof createInterface> | null = null;
  const getReadline = (): ReturnType<typeof createInterface> => {
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return rl;
  };
  const closeReadline = (): void => {
    rl?.close();
    rl = null;
  };
  try {
    const handle = await question(getReadline(), 'Handle', handleValue);
    const repo = normalizeExternalRepoUrl(
      await question(getReadline(), 'Repository', repoValue),
    );
    const ref = await question(getReadline(), 'Commit or ref', options.commit);
    const prefix =
      options.prefix ??
      (interactive
        ? (await getReadline().question('Prefix (optional): ')).trim()
        : '');
    const defaultFileExtensionValue =
      options.defaultFileExtension ??
      (interactive
        ? (
            await getReadline().question('Default file extension (optional): ')
          ).trim()
        : '');
    const defaultFileExtension = defaultFileExtensionValue
      ? normalizeExternalDefaultFileExtension(defaultFileExtensionValue)
      : '';
    let strategy = options.strategy;
    if (!strategy && interactive) {
      const inferred = inferExternalFetchUrl(repo);
      // selectMenu reads raw keypresses directly. Detach readline first so it
      // cannot consume the selection's Enter key or remain paused afterward.
      closeReadline();
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
      fetchUrl = await question(getReadline(), 'Fetch URL template');
    }
    const commit = await resolveExternalCommit(repo, ref);
    if (interactive) {
      const confirmation = (
        await getReadline().question(
          `Add external source "${handle}" at commit "${commit}" using "${strategy}"? [Y/n] `,
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
      ...(defaultFileExtension ? { defaultFileExtension } : {}),
      strategy: strategy as ExternalStrategy,
      ...(fetchUrl ? { fetchUrl } : {}),
    });
    return { output: `Added external source ${handle} at ${commit}` };
  } catch (error) {
    return { output: (error as Error).message, isError: true };
  } finally {
    closeReadline();
  }
}
