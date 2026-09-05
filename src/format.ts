import type { SourceSpan } from './search/types.js';
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
  opts?: {
    reason?: string;
    score?: number;
    text?: string;
    debug?: string;
    spans?: SourceSpan[];
  },
): string {
  const s = ctx.styler;
  const relPath = relative(
    process.cwd(),
    join(ctx.projectRoot, section.filePath),
  );

  const kind = section.id.includes('#') ? 'Section' : 'File';
  const details = [
    opts?.reason,
    opts?.debug,
    opts?.score === undefined ? undefined : `score: ${opts.score.toFixed(6)}`,
  ].filter((detail): detail is string => detail !== undefined);
  const detailsSuffix =
    details.length > 0 ? ' ' + s.dim(`(${details.join(', ')})`) : '';
  const lines: string[] = [
    `${s.dim('*')} ${s.dim(kind + ':')} [[${formatSectionId(section.id, s)}]]${detailsSuffix}`,
    `  ${s.dim('Defined in')} ${s.cyan(relPath)}${s.dim(`:${section.startLine}-${section.endLine}`)}`,
  ];

  if (opts?.spans?.length)
    lines.push(
      `  ${s.dim('Matched lines:')} ${opts.spans.map((span) => `${span.startLine}-${span.endLine}`).join(', ')}`,
    );

  const text = opts?.text ?? section.firstParagraph;
  if (text)
    lines.push(
      '',
      ...text.split('\n').map((line) => `  ${s.dim('>')} ${line}`),
    );

  return lines.join('\n');
}

export function formatResultList(
  ctx: CmdContext,
  header: string,
  matches: SectionMatch[],
  opts?: { showScores?: boolean; preview?: 'passage' | 'intro' | 'both' },
): string {
  const lines: string[] = ['', `## ${header}`, ''];

  for (let i = 0; i < matches.length; i++) {
    if (i > 0) lines.push('');
    lines.push(
      formatSectionPreview(ctx, matches[i].section, {
        reason: matches[i].reason,
        spans:
          opts?.preview === 'intro'
            ? undefined
            : matches[i].evidence?.[0]?.spans,
        score: opts?.showScores ? matches[i].rankScore : undefined,
        text:
          opts?.preview === 'intro'
            ? undefined
            : matches[i].evidence?.length
              ? (opts?.preview === 'both'
                  ? matches[i].section.firstParagraph + '\n\n'
                  : '') + matches[i].evidence![0].text
              : undefined,
        debug:
          opts?.showScores && matches[i].rankScore !== undefined
            ? JSON.stringify({
                lexicalRank: matches[i].lexicalRank,
                semanticRank: matches[i].semanticRank,
                lexicalScore: matches[i].lexicalScore,
                semanticSimilarity: matches[i].semanticSimilarity,
                lexicalContribution: matches[i].lexicalRank
                  ? 1 / (60 + matches[i].lexicalRank!)
                  : 0,
                semanticContribution: matches[i].semanticRank
                  ? 1 / (60 + matches[i].semanticRank!)
                  : 0,
                ...matches[i].diagnostics,
              })
            : undefined,
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
