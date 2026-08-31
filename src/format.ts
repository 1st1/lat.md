import { join, relative } from 'node:path';
import type { Section, SectionMatch } from './lattice-model.js';
import type { CmdContext, Styler } from './context.js';

export function formatSectionId(id: string, s: Styler): string {
  const parts = id.split('#');
  return parts.length === 1
    ? s.boldWhite(parts[0])
    : s.dim(parts.slice(0, -1).join('#') + '#') +
        s.boldWhite(parts[parts.length - 1]);
}

export function formatSectionPreview(
  ctx: CmdContext,
  section: Section,
  opts?: { reason?: string; score?: number },
): string {
  const s = ctx.styler;
  const relPath = relative(
    process.cwd(),
    join(ctx.projectRoot, section.filePath),
  );

  const kind = section.id.includes('#') ? 'Section' : 'File';
  const details = [
    opts?.reason,
    opts?.score === undefined ? undefined : `score: ${opts.score.toFixed(6)}`,
  ].filter((detail): detail is string => detail !== undefined);
  const detailsSuffix =
    details.length > 0 ? ' ' + s.dim(`(${details.join(', ')})`) : '';
  const lines: string[] = [
    `${s.dim('*')} ${s.dim(kind + ':')} [[${formatSectionId(section.id, s)}]]${detailsSuffix}`,
    `  ${s.dim('Defined in')} ${s.cyan(relPath)}${s.dim(`:${section.startLine}-${section.endLine}`)}`,
  ];

  if (section.firstParagraph) {
    lines.push('', `  ${s.dim('>')} ${section.firstParagraph}`);
  }

  return lines.join('\n');
}

export function formatResultList(
  ctx: CmdContext,
  header: string,
  matches: SectionMatch[],
  opts?: { showScores?: boolean },
): string {
  const lines: string[] = ['', `## ${header}`, ''];

  for (let i = 0; i < matches.length; i++) {
    if (i > 0) lines.push('');
    lines.push(
      formatSectionPreview(ctx, matches[i].section, {
        reason: matches[i].reason,
        score: opts?.showScores ? matches[i].score : undefined,
      }),
    );
  }

  lines.push('');
  return lines.join('\n');
}

export function formatNavHints(ctx: CmdContext): string {
  const s = ctx.styler;
  const hints =
    ctx.mode === 'cli'
      ? `${s.dim('*')} \`lat section "section#id"\` \u2014 show full content with outgoing/incoming refs\n` +
        `${s.dim('*')} \`lat search "new query"\` \u2014 search for something else`
      : `${s.dim('*')} \`lat_section\` \u2014 show full content with outgoing/incoming refs\n` +
        `${s.dim('*')} \`lat_search\` \u2014 search for something else`;
  return `\n## To navigate further:\n\n${hints}`;
}
