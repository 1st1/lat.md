import { join, relative } from 'node:path';
import {
  loadAllSections,
  findSections,
  type Section,
  type SectionMatch,
} from '../lattice.js';
import type { CmdContext, CmdResult } from '../context.js';
import {
  loadExternalSources,
  parseExternalTarget,
  resolveExternalTarget,
  type ExternalResolution,
} from '../external-sources.js';

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

function formatLocation(section: Section, projectRoot: string): string {
  const relPath = relative(process.cwd(), join(projectRoot, section.filePath));
  return `${relPath}:${section.startLine}-${section.endLine}`;
}

type ResolvedRef = {
  target: string;
  best: SectionMatch;
  alternatives: SectionMatch[];
};

type ExpandedRef =
  | { kind: 'section'; data: ResolvedRef }
  | { kind: 'external'; data: ExternalResolution };

/**
 * Resolve [[refs]] in text and return the expanded output.
 * Returns null if there are no wiki links, or if resolution fails.
 */
export async function expandPrompt(
  ctx: CmdContext,
  text: string,
): Promise<string | null> {
  const refs = [...text.matchAll(WIKI_LINK_RE)];
  if (refs.length === 0) return null;

  const allSections = await loadAllSections(ctx.latDir);
  const externalSources = loadExternalSources(ctx.projectRoot);
  const resolved = new Map<string, ExpandedRef>();
  const errors: string[] = [];

  for (const match of refs) {
    const target = match[1];
    if (resolved.has(target)) continue;

    const external = parseExternalTarget(target, externalSources.sources);
    if (external) {
      resolved.set(target, {
        kind: 'external',
        data: resolveExternalTarget(external),
      });
      continue;
    }

    const matches = findSections(allSections, target);
    if (matches.length >= 1) {
      resolved.set(target, {
        kind: 'section',
        data: {
          target,
          best: matches[0],
          alternatives: matches.slice(1),
        },
      });
    } else {
      errors.push(`No section found for [[${target}]]`);
    }
  }

  if (errors.length > 0) return null;

  // Replace [[refs]] inline
  let output = text.replace(WIKI_LINK_RE, (_match, target: string) => {
    const ref = resolved.get(target)!;
    if (ref.kind === 'external') {
      return `[[${target}]]`;
    }
    return `[[${ref.data.best.section.id}]]`;
  });

  // Append context block as nested outliner
  output += '\n\n<lat-context>\n';
  for (const ref of resolved.values()) {
    if (ref.kind === 'external') {
      output += `* \`[[${ref.data.target}]]\` is referring to:\n`;
      output += `  * external source ${ref.data.handle}\n`;
      if (ref.data.rev) {
        output += `    * pinned rev: ${ref.data.rev}\n`;
      }
      if (ref.data.activeKind === 'local' && ref.data.localPath) {
        const localLoc = ref.data.line
          ? ref.data.endLine && ref.data.endLine !== ref.data.line
            ? `${ref.data.localPath}:${ref.data.line}-${ref.data.endLine}`
            : `${ref.data.localPath}:${ref.data.line}`
          : ref.data.localPath;
        output += `    * local: ${ref.data.localFileUrl}\n`;
        output += `    * path: ${localLoc}\n`;
      } else {
        output += `    * canonical: ${ref.data.browseUrl}\n`;
      }
      continue;
    }

    const isExact =
      ref.data.best.reason === 'exact match' ||
      ref.data.best.reason.startsWith('file stem expanded');
    const all = isExact
      ? [ref.data.best]
      : [ref.data.best, ...ref.data.alternatives];

    if (isExact) {
      output += `* \`[[${ref.data.target}]]\` is referring to:\n`;
    } else {
      output += `* \`[[${ref.data.target}]]\` might be referring to either of the following:\n`;
    }

    for (const m of all) {
      const reason = isExact ? '' : ` (${m.reason})`;
      output += `  * [[${m.section.id}]]${reason}\n`;
      output += `    * ${formatLocation(m.section, ctx.projectRoot)}\n`;
      if (m.section.firstParagraph) {
        output += `    * ${m.section.firstParagraph}\n`;
      }
    }
  }
  output += '</lat-context>\n';

  return output;
}

export async function expandCommand(
  ctx: CmdContext,
  text: string,
): Promise<CmdResult> {
  const result = await expandPrompt(ctx, text);

  if (result === null) {
    const refs = [...text.matchAll(WIKI_LINK_RE)];
    if (refs.length === 0) {
      return { output: text };
    }

    // Resolution failed — find which ref is broken
    const allSections = await loadAllSections(ctx.latDir);
    const externalSources = loadExternalSources(ctx.projectRoot);
    for (const match of refs) {
      const target = match[1];
      if (parseExternalTarget(target, externalSources.sources)) continue;
      const matches = findSections(allSections, target);
      if (matches.length === 0) {
        const s = ctx.styler;
        return {
          output:
            s.red(`No section found for [[${target}]]`) +
            ' (no exact, substring, or fuzzy matches).\n' +
            s.dim('Ask the user to correct the reference.'),
          isError: true,
        };
      }
    }

    // All refs matched individually but expansion still failed — shouldn't happen
    return { output: text };
  }

  return { output: result };
}
