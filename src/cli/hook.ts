import { execSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { findLatticeDir } from '../project-discovery.js';
import { plainStyler, type CmdContext } from '../context.js';
import { expandPrompt } from './expand.js';
import { runSearch } from './search.js';
import { DEFAULT_SEARCH_LIMIT } from '../search/search.js';
import { getSection, formatSectionOutput } from './section.js';
import { checkMd, checkCodeRefs, checkIndex, checkSections } from './check.js';
import { CheckRunContext } from './check-context.js';
import { isSourceFileExtension } from '../source-formats.js';
import { commandProjectAnalysis } from '../project-analysis.js';

function outputPromptSubmit(context: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    }),
  );
}

function outputStop(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason,
    }),
  );
}

function outputCursorStop(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      followup_message: reason,
    }),
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function hasWikiLinks(text: string): boolean {
  return /\[\[[^\]]+\]\]/.test(text);
}

function makeHookCtx(latDir: string): CmdContext {
  return {
    latDir,
    projectRoot: dirname(latDir),
    styler: plainStyler,
    mode: 'cli',
  };
}

async function searchAndExpand(
  ctx: CmdContext,
  userPrompt: string,
): Promise<string | null> {
  let result;
  try {
    // Read-only: search an existing index but never build/update it here. A fresh
    // repo's first prompt must not trigger a full local embed pass — that's what
    // `lat search` / `lat reindex` are for. Returns no matches until then.
    result = await runSearch(
      ctx.latDir,
      userPrompt,
      DEFAULT_SEARCH_LIMIT,
      undefined,
      {
        buildIndex: false,
        project: await commandProjectAnalysis(ctx),
      },
    );
  } catch {
    // No usable backend (e.g. reindex required, key rejected) — skip semantic
    // enrichment silently rather than blocking the user's prompt.
    return null;
  }
  if (result.matches.length === 0) return null;

  const parts: string[] = [
    `Search results for the user prompt (${result.matches.length} matches):`,
    '',
  ];

  for (const match of result.matches) {
    const sectionResult = await getSection(ctx, match.section.id);
    if (sectionResult.kind === 'found') {
      parts.push(formatSectionOutput(ctx, sectionResult));
      parts.push('');
    }
  }

  return parts.join('\n');
}

async function handleUserPromptSubmit(): Promise<void> {
  let userPrompt = '';
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    userPrompt = input.user_prompt ?? input.prompt ?? '';
  } catch {
    // If we can't parse stdin, still emit the reminder
  }

  const parts: string[] = [];

  parts.push(
    "Before starting work, run `lat search` with one or more queries describing the user's intent.",
    'ALWAYS do this, even when the task seems straightforward — search results may reveal critical design details, protocols, or constraints.',
    'Use `lat section` to read the full content of relevant matches.',
    'Do not read files, write code, or run commands until you have searched.',
    '',
    'Remember: `lat.md/` must stay in sync with meaningful codebase state. If you change behavior, architecture, tests, or planned work, update the relevant current-state sections and run `lat check` before finishing. Do not use `lat.md/` as a journal/changelog or add notes for insignificant details.',
  );

  const latDir = findLatticeDir();
  if (latDir && userPrompt) {
    const ctx = makeHookCtx(latDir);

    // If the user prompt contains [[refs]], resolve them inline
    if (hasWikiLinks(userPrompt)) {
      try {
        const expanded = await expandPrompt(ctx, userPrompt);
        if (expanded) {
          parts.push(
            '',
            'Expanded user prompt with resolved [[refs]]:',
            expanded,
          );
        } else {
          parts.push(
            '',
            'NOTE: The user prompt contains [[refs]] but they could not be resolved. Ask the user to correct them.',
          );
        }
      } catch {
        parts.push(
          '',
          'NOTE: The user prompt contains [[refs]] but resolution failed. Run `lat expand` on the prompt text manually.',
        );
      }
    }

    // Search for relevant sections and include their full content
    try {
      const searchContext = await searchAndExpand(ctx, userPrompt);
      if (searchContext) {
        parts.push('', searchContext);
      }
    } catch {
      // Search failed (no key, index error, etc.) — agent can search manually
    }
  }

  outputPromptSubmit(parts.join('\n'));
}

/** Minimum diff size (in lines) to consider "significant" code change. */
/** Minimum code change size (lines) before we consider flagging lat.md/ sync. */
const DIFF_THRESHOLD = 5;

/** lat.md/ changes below this ratio of code changes trigger a sync reminder. */
const LATMD_RATIO = 0.05;

/** If lat.md/ changes exceed this many lines, skip the ratio check entirely. */
const LATMD_UPPER_THRESHOLD = 50;

type DiffFileKind = 'code' | 'latMd';

function diffFileKind(file: string): DiffFileKind | null {
  if (file.startsWith('lat.md/')) return 'latMd';
  if (isSourceFileExtension(extname(file))) return 'code';
  return null;
}

/** Count a regular text file's lines as additions, matching Git numstat. */
function countUntrackedFileLines(projectRoot: string, file: string): number {
  try {
    const path = join(projectRoot, file);
    if (!lstatSync(path).isFile()) return 0;
    const text = readFileSync(path, 'utf-8');
    if (text.length === 0) return 0;
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return 0;
  }
}

/**
 * Measure code vs `lat.md/` churn since HEAD, in lines. Combines tracked
 * changes (`git diff HEAD --numstat`) with untracked files
 * (`git ls-files --others --exclude-standard -z`). Counting untracked files is
 * what makes a freshly scaffolded, never-committed `lat.md/` register as
 * updated — otherwise its edits are invisible to `git diff HEAD` and the sync
 * reminder fires on every turn until `lat.md/` is committed (issue #61).
 * Both scans are scoped and made relative to `projectRoot`, so a Lat project
 * nested in a larger worktree neither misses its own `lat.md/` paths nor counts
 * changes from sibling projects.
 * Outside a Git worktree both scans contribute zero churn by design: Git is
 * optional, so the hook still validates the project but skips the sync ratio.
 */
export function analyzeDiff(projectRoot: string): {
  codeLines: number;
  latMdLines: number;
} {
  let codeLines = 0;
  let latMdLines = 0;

  const tally = (kind: DiffFileKind, changed: number): void => {
    if (kind === 'latMd') {
      latMdLines += changed;
    } else {
      codeLines += changed;
    }
  };

  // Tracked changes vs HEAD. Throws when there is no HEAD yet (a repo with no
  // commits) or no repo at all; the untracked scan below still runs.
  try {
    const output = execSync('git diff HEAD --numstat --relative -- .', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Each line: "added\tremoved\tfile" (e.g. "42\t11\tsrc/cli/hook.ts")
    for (const line of output.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const added = parseInt(parts[0], 10) || 0;
      const removed = parseInt(parts[1], 10) || 0;
      const kind = diffFileKind(parts[2]);
      if (kind) tally(kind, added + removed);
    }
  } catch {
    // Not a git repo, or no HEAD — fall through to the untracked scan.
  }

  // NUL-delimited output preserves spaces, non-ASCII names, and newlines.
  // Classify paths before reading so unrelated untracked files are never read.
  try {
    const output = execSync(
      'git ls-files --others --exclude-standard -z -- .',
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    for (const file of output.split('\0')) {
      if (!file) continue;
      const kind = diffFileKind(file);
      if (!kind) continue;
      tally(kind, countUntrackedFileLines(projectRoot, file));
    }
  } catch {
    // Not a Git repo — diff-based sync analysis is intentionally disabled.
  }

  return { codeLines, latMdLines };
}

type StopStatus = {
  checkFailed: boolean;
  totalErrors: number;
  needsSync: boolean;
  codeLines: number;
  latMdLines: number;
};

async function getStopStatus(latDir: string): Promise<StopStatus> {
  const projectRoot = dirname(latDir);
  const run = new CheckRunContext(latDir, projectRoot);
  const [md, code, indexErrors, sectionErrors] = await Promise.all([
    checkMd(latDir, projectRoot, run),
    checkCodeRefs(latDir, projectRoot, run),
    checkIndex(latDir, run),
    checkSections(latDir, projectRoot, run),
  ]);
  const totalErrors =
    md.errors.length +
    code.errors.length +
    indexErrors.length +
    sectionErrors.length;
  const checkFailed = totalErrors > 0;

  const { codeLines, latMdLines } = analyzeDiff(projectRoot);
  let needsSync = false;
  if (codeLines >= DIFF_THRESHOLD && latMdLines < LATMD_UPPER_THRESHOLD) {
    const effectiveLatMd = latMdLines === 0 ? 0 : Math.max(latMdLines, 1);
    needsSync = effectiveLatMd < codeLines * LATMD_RATIO;
  }

  return {
    checkFailed,
    totalErrors,
    needsSync,
    codeLines,
    latMdLines,
  };
}

function formatStopReason({
  checkFailed,
  totalErrors,
  needsSync,
  codeLines,
  latMdLines,
}: StopStatus): string | null {
  if (!checkFailed && !needsSync) return null;

  const parts: string[] = [];

  const syncMsg =
    latMdLines === 0
      ? 'The codebase has changes (' +
        codeLines +
        ' lines) but `lat.md/` was not updated.'
      : 'The codebase has changes (' +
        codeLines +
        ' lines) but `lat.md/` may not be fully in sync (' +
        latMdLines +
        ' lines changed).';

  if (checkFailed && needsSync) {
    parts.push(
      '`lat check` found errors. ' + syncMsg + ' Before finishing:',
      '',
      '1. Update `lat.md/` where changes affect behavior, architecture, tests, or plans; keep it focused on current state rather than journal/changelog notes.',
      '2. Run `lat check` until it passes.',
    );
  } else if (checkFailed) {
    parts.push(
      '`lat check` found ' +
        totalErrors +
        ' error(s). Run `lat check`, fix the errors, and repeat until it passes.',
    );
  } else {
    parts.push(
      syncMsg +
        ' Review whether `lat.md/` needs a current-state update; do not add journal/changelog notes just to satisfy this reminder. Run `lat search` to find relevant sections and `lat check` at the end.',
    );
  }

  return parts.join('\n');
}

async function handleStop(): Promise<void> {
  const latDir = findLatticeDir();
  if (!latDir) return;

  // Read stdin to check if we already blocked once
  let stopHookActive = false;
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    stopHookActive = input.stop_hook_active ?? false;
  } catch {
    // If we can't parse stdin, treat as first attempt
  }

  const status = await getStopStatus(latDir);

  // Second pass — warn the user but don't block again
  if (stopHookActive) {
    if (status.checkFailed) {
      console.error(
        `lat check is still failing (${status.totalErrors} error(s)). Run \`lat check\` to see details.`,
      );
    }
    return;
  }

  const reason = formatStopReason(status);
  if (!reason) return;
  outputStop(reason);
}

async function handleCursorStop(): Promise<void> {
  const latDir = findLatticeDir();
  if (!latDir) return;

  const reason = formatStopReason(await getStopStatus(latDir));
  if (!reason) return;
  outputCursorStop(reason);
}

export async function hookCmd(agent: string, event: string): Promise<void> {
  switch (agent) {
    case 'claude':
      switch (event) {
        case 'UserPromptSubmit':
          await handleUserPromptSubmit();
          return;
        case 'Stop':
          await handleStop();
          return;
        default:
          console.error(
            `Unknown hook event for claude: ${event}. Supported: UserPromptSubmit, Stop`,
          );
          process.exit(1);
      }
    case 'codex':
      switch (event) {
        case 'UserPromptSubmit':
          await handleUserPromptSubmit();
          return;
        case 'Stop':
          await handleStop();
          return;
        default:
          console.error(
            `Unknown hook event for codex: ${event}. Supported: UserPromptSubmit, Stop`,
          );
          process.exit(1);
      }
    case 'cursor':
      switch (event) {
        case 'stop':
          await handleCursorStop();
          return;
        default:
          console.error(
            `Unknown hook event for cursor: ${event}. Supported: stop`,
          );
          process.exit(1);
      }
    default:
      console.error(
        `Unknown agent: ${agent}. Supported: claude, codex, cursor`,
      );
      process.exit(1);
  }
}
