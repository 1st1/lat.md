import { readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import {
  findSections,
  flattenSections,
  resolveRef,
  type Section,
  type SectionMatch,
} from '../lattice.js';
import { MAX_SECTION_SUMMARY_LENGTH } from '../markdown-validation.js';
import { resolveSourceSymbol } from '../source-parser.js';
import { isSourceFileExtension } from '../source-formats.js';
import type { CmdContext, CmdResult } from '../context.js';
import {
  formatNavHints,
  formatResultList,
  formatSectionId,
} from '../format.js';
import type { ResolvedExternalContent } from '../external-sources.js';
import { findRefs } from './refs.js';
import {
  commandProjectAnalysis,
  commandProjectSession,
} from '../project-analysis.js';

export type CodeBackRef = {
  file: string;
  line: number;
  snippet: string;
};

export type SourceRef = {
  target: string;
  file: string;
  line: number;
  endLine: number;
  snippet: string;
};

export type SectionFound = {
  kind: 'found';
  section: Section;
  content: string;
  outgoingRefs: { target: string; resolved: Section }[];
  outgoingSourceRefs: SourceRef[];
  outgoingExternalRefs: ResolvedExternalContent[];
  incomingRefs: SectionMatch[];
  codeRefs: CodeBackRef[];
};

export type SectionResult =
  | SectionFound
  | { kind: 'no-match'; suggestions: SectionMatch[] };

/**
 * Look up a section by id, return its content, outgoing wiki link targets,
 * and incoming references from other sections.
 */
export async function getSection(
  ctx: CmdContext,
  query: string,
): Promise<SectionResult> {
  query = query.replace(/^\[\[|\]\]$/g, '');

  const project = await commandProjectAnalysis(ctx);
  const matches = findSections(project.allSections, query);

  if (matches.length === 0) {
    return { kind: 'no-match', suggestions: [] };
  }

  // Accept the top match if confident
  const top = matches[0];
  const isConfident =
    top.reason === 'exact match' ||
    top.reason.startsWith('file stem expanded') ||
    top.reason === 'section name match';

  if (!isConfident) {
    return { kind: 'no-match', suggestions: matches };
  }

  const section = top.section;

  // Read raw content between startLine and the end of the last descendant
  const absPath = join(ctx.projectRoot, section.filePath);
  const analyzedFile = project.filesByAbsolutePath.get(absPath);
  if (!analyzedFile) return { kind: 'no-match', suggestions: [] };
  const fileContent = analyzedFile.content;
  const lines = fileContent.split('\n');
  const end = fullEndLine(section);
  const content = lines.slice(section.startLine - 1, end).join('\n');

  // Find outgoing wiki link targets within this section's content
  const flat = project.sections;
  const sectionIds = new Set(project.sectionIds);
  const { fileIndex, slugIndex } = project;
  const sectionId = section.id.toLowerCase();
  const subtreeSections = flattenSections([section]);
  const subtreeSectionIds = new Set(
    subtreeSections.map((subtreeSection) => subtreeSection.id.toLowerCase()),
  );
  const sectionRefs = subtreeSections.flatMap(
    (subtreeSection) =>
      project.outgoingRefsBySection.get(subtreeSection.id.toLowerCase()) ?? [],
  );

  const outgoingRefs: { target: string; resolved: Section }[] = [];
  const outgoingSourceRefs: SourceRef[] = [];
  const outgoingExternalRefs: ResolvedExternalContent[] = [];
  const external = await commandProjectSession(ctx).external();
  const seen = new Set<string>();
  for (const ref of sectionRefs) {
    if (!subtreeSectionIds.has(ref.fromSection.toLowerCase())) continue;
    if (external.parse(ref.target)) {
      if (!seen.has(ref.target)) {
        seen.add(ref.target);
        outgoingExternalRefs.push(await external.resolve(ref.target));
      }
      continue;
    }
    // Detect source code references by file extension
    const hashIdx = ref.target.indexOf('#');
    const filePart = hashIdx === -1 ? ref.target : ref.target.slice(0, hashIdx);
    const ext = extname(filePart);
    if (isSourceFileExtension(ext)) {
      const targetLower = ref.target.toLowerCase();
      if (!seen.has(targetLower)) {
        seen.add(targetLower);
        const symbolPart = hashIdx === -1 ? '' : ref.target.slice(hashIdx + 1);
        let line = 0;
        let endLine = 0;
        let snippet = '';
        if (symbolPart) {
          const { found, symbols } = await resolveSourceSymbol(
            filePart,
            symbolPart,
            ctx.projectRoot,
            commandProjectSession(ctx).sourceSymbolOptions(),
          );
          if (found) {
            const parts = symbolPart.split('#');
            const sym = symbols.find((s) =>
              parts.length === 1
                ? s.name === parts[0] && !s.parent
                : s.name === parts[1] && s.parent === parts[0],
            );
            if (sym) {
              line = sym.startLine;
              endLine = sym.endLine;
              try {
                const src = await readFile(
                  join(ctx.projectRoot, filePart),
                  'utf-8',
                );
                const srcLines = src.split('\n');
                const start = sym.startLine - 1;
                const end = Math.min(srcLines.length, start + 5);
                snippet = srcLines.slice(start, end).join('\n');
              } catch {
                // file unreadable
              }
            }
          }
        }
        outgoingSourceRefs.push({
          target: ref.target,
          file: filePart,
          line,
          endLine,
          snippet,
        });
      }
      continue;
    }
    const { resolved } = resolveRef(
      ref.target,
      sectionIds,
      fileIndex,
      slugIndex,
    );
    const resolvedLower = resolved.toLowerCase();
    if (seen.has(resolvedLower)) continue;
    seen.add(resolvedLower);
    const targetSection = flat.find(
      (s) => s.id.toLowerCase() === resolvedLower,
    );
    if (targetSection) {
      outgoingRefs.push({ target: ref.target, resolved: targetSection });
    }
  }

  // Find incoming references: other sections that link to this one
  const incomingRefs: SectionMatch[] = [];
  const incomingSections = new Set<string>();

  for (const ref of project.incomingRefsBySection.get(sectionId) ?? []) {
    if (ref.fromSection.toLowerCase() === sectionId) continue;
    if (!incomingSections.has(ref.fromSection.toLowerCase())) {
      incomingSections.add(ref.fromSection.toLowerCase());
      const fromSection = project.sectionById.get(
        ref.fromSection.toLowerCase(),
      );
      if (fromSection) {
        incomingRefs.push({ section: fromSection, reason: 'wiki link' });
      }
    }
  }

  // Find code back-references: @lat: comments pointing to this section
  const codeRefs: CodeBackRef[] = [];
  const { refs: scannedRefs } = await commandProjectSession(ctx).codeRefs();
  for (const ref of scannedRefs) {
    const { resolved: codeResolved } = resolveRef(
      ref.target,
      sectionIds,
      fileIndex,
      slugIndex,
    );
    if (subtreeSectionIds.has(codeResolved.toLowerCase())) {
      const absFile = join(ctx.projectRoot, ref.file);
      let snippet = '';
      try {
        const src = await readFile(absFile, 'utf-8');
        const srcLines = src.split('\n');
        const start = Math.max(0, ref.line - 1 - 2);
        const end = Math.min(srcLines.length, ref.line - 1 + 3);
        snippet = srcLines.slice(start, end).join('\n');
      } catch {
        // file unreadable — skip snippet
      }
      codeRefs.push({ file: ref.file, line: ref.line, snippet });
    }
  }

  return {
    kind: 'found',
    section,
    content,
    outgoingRefs,
    outgoingSourceRefs,
    outgoingExternalRefs,
    incomingRefs,
    codeRefs,
  };
}

function fullEndLine(section: Section): number {
  if (section.children.length === 0) return section.endLine;
  return fullEndLine(section.children[section.children.length - 1]);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

const SECTION_SUMMARY_SAFETY_LIMIT = MAX_SECTION_SUMMARY_LENGTH + 50;

function sectionSummary(section: Section): string {
  return truncate(section.firstParagraph, SECTION_SUMMARY_SAFETY_LIMIT);
}

function markdownInlineCode(value: string): string {
  const content = value || ' ';
  const longestBacktickRun = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map((run) => run.length),
  );
  const delimiter = '`'.repeat(longestBacktickRun + 1);
  const padded =
    content.startsWith('`') || content.endsWith('`') ? ` ${content} ` : content;
  return `${delimiter}${padded}${delimiter}`;
}

/**
 * Format a successful section result with styling.
 */
export function formatSectionOutput(
  ctx: CmdContext,
  result: SectionFound,
): string {
  const s = ctx.styler;
  const {
    section,
    content,
    outgoingRefs,
    outgoingSourceRefs,
    outgoingExternalRefs,
    incomingRefs,
    codeRefs,
  } = result;
  const relPath = relative(
    process.cwd(),
    join(ctx.projectRoot, section.filePath),
  );
  const loc = `${s.cyan(relPath)}${s.dim(`:${section.startLine}-${section.endLine}`)}`;

  const quoted = content
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

  const parts: string[] = [
    `${s.bold('[[' + formatSectionId(section.id, s) + ']]')} (${loc})`,
    '',
    quoted,
  ];

  if (
    outgoingRefs.length > 0 ||
    outgoingSourceRefs.length > 0 ||
    outgoingExternalRefs.length > 0
  ) {
    parts.push('', '## This section references:', '');
    for (const ref of outgoingRefs) {
      const body = ref.resolved.firstParagraph
        ? ` ${s.dim('—')} ${sectionSummary(ref.resolved)}`
        : '';
      parts.push(
        `${s.dim('*')} [[${formatSectionId(ref.resolved.id, s)}]]${body}`,
      );
    }
    for (const ref of outgoingSourceRefs) {
      const loc = ref.line
        ? ref.endLine && ref.endLine !== ref.line
          ? `${s.dim(` (${ref.file}:${ref.line}-${ref.endLine})`)}`
          : `${s.dim(` (${ref.file}:${ref.line})`)}`
        : `${s.dim(` (${ref.file})`)}`;
      parts.push(`${s.dim('*')} [[${s.cyan(ref.target)}]]${loc}`);
      if (ref.snippet) {
        const snippetLines = ref.snippet.split('\n');
        for (const line of snippetLines) {
          parts.push(`  ${s.dim('|')} ${markdownInlineCode(line)}`);
        }
      }
    }
    for (const ref of outgoingExternalRefs) {
      parts.push(
        `${s.dim('*')} [[${s.cyan(ref.target.identity)}]]${s.dim(` (${ref.target.repositoryPath}:${ref.startLine}-${ref.endLine}, ${ref.provider})`)}`,
      );
      for (const line of ref.content.split('\n').slice(0, 5)) {
        parts.push(
          `  ${s.dim('|')} ${ref.kind === 'source' ? markdownInlineCode(line) : line}`,
        );
      }
    }
  }

  if (incomingRefs.length > 0) {
    parts.push('', '## Referenced by:', '');
    for (const ref of incomingRefs) {
      const body = ref.section.firstParagraph
        ? ` ${s.dim('—')} ${sectionSummary(ref.section)}`
        : '';
      parts.push(
        `${s.dim('*')} [[${formatSectionId(ref.section.id, s)}]]${body}`,
      );
    }
  }

  if (codeRefs.length > 0) {
    parts.push('', '## Referenced by code:', '');
    for (const ref of codeRefs) {
      const codeRelPath = relative(
        process.cwd(),
        join(ctx.projectRoot, ref.file),
      );
      parts.push(
        `${s.dim('*')} ${s.cyan(codeRelPath)}${s.dim(`:${ref.line}`)}`,
      );
      if (ref.snippet) {
        const snippetLines = ref.snippet.split('\n');
        for (const line of snippetLines) {
          parts.push(`  ${s.dim('|')} ${markdownInlineCode(line)}`);
        }
      }
    }
  }

  parts.push(formatNavHints(ctx));

  return parts.join('\n');
}

export async function sectionCommand(
  ctx: CmdContext,
  query: string,
): Promise<CmdResult> {
  const external = await commandProjectSession(ctx).external();
  let externalTarget = null;
  try {
    externalTarget = external.parse(query);
  } catch (error) {
    return { output: ctx.styler.red((error as Error).message), isError: true };
  }
  if (externalTarget) {
    try {
      const resolved = await external.resolve(query);
      const backlinks = await findRefs(
        ctx,
        resolved.target.identity,
        'md+code',
      );
      const location = `${resolved.target.handle}:${resolved.target.authoredPath}:${resolved.startLine}-${resolved.endLine}`;
      const quoted = resolved.content
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
      const warnings = resolved.source.localError
        ? `\n\n${ctx.styler.yellow(`Warning: ${resolved.source.localError}; using ${resolved.provider}`)}`
        : '';
      const parts = [
        `${ctx.styler.bold(`[[${resolved.target.identity}]]`)} (${ctx.styler.cyan(location)})`,
        ctx.styler.dim(
          `${resolved.source.repo} @ ${resolved.source.commit} via ${resolved.provider}`,
        ),
        '',
        quoted,
      ];
      if (backlinks.kind === 'found' && backlinks.mdRefs.length > 0) {
        parts.push(
          formatResultList(ctx, `Referenced by Markdown:`, backlinks.mdRefs),
        );
      }
      if (backlinks.kind === 'found' && backlinks.codeRefs.length > 0) {
        parts.push(
          '',
          '## Referenced by code:',
          '',
          ...backlinks.codeRefs.map(
            (value) => `${ctx.styler.dim('*')} ${value}`,
          ),
        );
      }
      return {
        output: parts.join('\n') + warnings + formatNavHints(ctx),
      };
    } catch (error) {
      return {
        output: ctx.styler.red((error as Error).message),
        isError: true,
      };
    }
  }
  const unknownExternal = external.unknownTargetMessage(query);
  if (unknownExternal) {
    return { output: ctx.styler.red(unknownExternal), isError: true };
  }
  const result = await getSection(ctx, query);

  if (result.kind === 'no-match') {
    const s = ctx.styler;
    if (result.suggestions.length > 0) {
      const suggestions = result.suggestions
        .map(
          (m) =>
            `  ${s.dim('*')} ${s.white(m.section.id)} ${s.dim(`(${m.reason})`)}`,
        )
        .join('\n');
      return {
        output:
          s.red(`No section "${query}" found.`) +
          ' Did you mean:\n' +
          suggestions,
        isError: true,
      };
    }
    return {
      output: s.red(`No sections matching "${query}"`),
      isError: true,
    };
  }

  return { output: formatSectionOutput(ctx, result) };
}
