import { join, relative } from 'node:path';
import { findSections, type Section, type SectionMatch } from '../lattice.js';
import type { CmdContext, CmdResult } from '../context.js';
import type { ResolvedExternalContent } from '../external-sources.js';
import {
  commandProjectAnalysis,
  commandProjectSession,
} from '../project-analysis.js';

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

type ResolvedExternalRef = ResolvedExternalContent;

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

  const { allSections } = await commandProjectAnalysis(ctx);
  const resolved = new Map<string, ResolvedRef>();
  const externalResolved = new Map<string, ResolvedExternalRef>();
  const external = await commandProjectSession(ctx).external();
  const errors: string[] = [];

  for (const match of refs) {
    const target = match[1];
    if (resolved.has(target) || externalResolved.has(target)) continue;

    try {
      if (external.parse(target)) {
        externalResolved.set(target, await external.resolve(target));
        continue;
      }
    } catch (error) {
      errors.push((error as Error).message);
      continue;
    }
    const unknownExternal = external.unknownTargetMessage(target);
    if (unknownExternal) {
      errors.push(unknownExternal);
      continue;
    }

    const matches = findSections(allSections, target);
    if (matches.length >= 1) {
      resolved.set(target, {
        target,
        best: matches[0],
        alternatives: matches.slice(1),
      });
    } else {
      errors.push(`No section found for [[${target}]]`);
    }
  }

  if (errors.length > 0) return null;

  // Replace [[refs]] inline
  let output = text.replace(WIKI_LINK_RE, (_match, target: string) => {
    if (externalResolved.has(target)) return `[[${target}]]`;
    const ref = resolved.get(target)!;
    return `[[${ref.best.section.id}]]`;
  });

  // Append context block as nested outliner
  output += '\n\n<lat-context>\n';
  for (const [target, value] of externalResolved) {
    output += `* \`[[${target}]]\` is referring to:\n`;
    output += `  * ${value.source.repo} @ ${value.source.commit} via ${value.provider}\n`;
    output += `    * ${value.target.repositoryPath}:${value.startLine}-${value.endLine}\n`;
    for (const line of value.content.split('\n')) output += `    | ${line}\n`;
  }
  for (const ref of resolved.values()) {
    const isExact =
      ref.best.reason === 'exact match' ||
      ref.best.reason.startsWith('file stem expanded');
    const all = isExact ? [ref.best] : [ref.best, ...ref.alternatives];

    if (isExact) {
      output += `* \`[[${ref.target}]]\` is referring to:\n`;
    } else {
      output += `* \`[[${ref.target}]]\` might be referring to either of the following:\n`;
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
    const { allSections } = await commandProjectAnalysis(ctx);
    const external = await commandProjectSession(ctx).external();
    for (const match of refs) {
      const target = match[1];
      try {
        if (external.parse(target)) {
          await external.resolve(target);
          continue;
        }
      } catch (error) {
        return {
          output: ctx.styler.red((error as Error).message),
          isError: true,
        };
      }
      const unknownExternal = external.unknownTargetMessage(target);
      if (unknownExternal) {
        return {
          output: ctx.styler.red(unknownExternal),
          isError: true,
        };
      }
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
