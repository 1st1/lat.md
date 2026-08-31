import { existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import {
  findSections,
  resolveRef,
  type Section,
  type SectionMatch,
} from '../lattice.js';
import { formatResultList } from '../format.js';
import type { CmdContext, CmdResult } from '../context.js';
import {
  commandProjectAnalysis,
  commandProjectSession,
} from '../project-analysis.js';
import { isSourceFileExtension } from '../source-formats.js';

export type Scope = 'md' | 'code' | 'md+code';

export type RefsFound = {
  kind: 'found';
  target: Section;
  mdRefs: SectionMatch[];
  codeRefs: string[];
};

export type RefsError = {
  kind: 'no-match';
  suggestions: SectionMatch[];
  message?: string;
};

export type RefsResult = RefsFound | RefsError;

/**
 * Check if a query looks like a source file path (has a recognized extension
 * and the file exists on disk).
 */
function isSourceQuery(
  query: string,
  projectRoot: string,
): { filePart: string; symbolPart: string } | null {
  const hashIdx = query.indexOf('#');
  const filePart = hashIdx === -1 ? query : query.slice(0, hashIdx);
  const symbolPart = hashIdx === -1 ? '' : query.slice(hashIdx + 1);
  const ext = extname(filePart);
  if (!isSourceFileExtension(ext)) return null;
  if (!existsSync(join(projectRoot, filePart))) return null;
  return { filePart, symbolPart };
}

/**
 * Find references to a source file or symbol across lat.md and code files.
 * For file-level queries (no #symbol), matches all wiki links targeting
 * that file or any symbol in it.
 */
async function findSourceRefs(
  ctx: CmdContext,
  query: string,
  scope: Scope,
): Promise<RefsResult> {
  const { projectRoot } = ctx;
  const hashIdx = query.indexOf('#');
  const filePart = hashIdx === -1 ? query : query.slice(0, hashIdx);
  const isFileLevel = hashIdx === -1;
  const queryLower = query.toLowerCase();
  const fileLower = filePart.toLowerCase();

  // Build a synthetic Section for the target
  const target: Section = {
    id: query,
    heading: hashIdx === -1 ? filePart : query.slice(hashIdx + 1),
    depth: 0,
    file: filePart,
    filePath: filePart,
    children: [],
    startLine: 0,
    endLine: 0,
    firstParagraph: '',
  };

  // Try to get real line info from the source parser
  try {
    const { resolveSourceSymbol } = await import('../source-parser.js');
    if (hashIdx !== -1) {
      const symbolPart = query.slice(hashIdx + 1);
      const { found, symbols } = await resolveSourceSymbol(
        filePart,
        symbolPart,
        projectRoot,
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
          target.startLine = sym.startLine;
          target.endLine = sym.endLine;
          target.firstParagraph = sym.signature;
        }
      }
    }
  } catch {
    // source parser unavailable — proceed without line info
  }

  const project = await commandProjectAnalysis(ctx);
  const flat = project.sections;
  const mdRefs: SectionMatch[] = [];
  const codeRefs: string[] = [];

  if (scope === 'md' || scope === 'md+code') {
    const matchingFromSections = new Set<string>();
    for (const file of project.files.values()) {
      for (const ref of file.wikiRefs) {
        const targetLower = ref.target.toLowerCase();
        const matches = isFileLevel
          ? targetLower === fileLower || targetLower.startsWith(fileLower + '#')
          : targetLower === queryLower;
        if (matches) {
          matchingFromSections.add(ref.fromSection.toLowerCase());
        }
      }
    }

    if (matchingFromSections.size > 0) {
      const referrers = flat.filter((s) =>
        matchingFromSections.has(s.id.toLowerCase()),
      );
      for (const s of referrers) {
        mdRefs.push({ section: s, reason: 'wiki link' });
      }
    }
  }

  if (scope === 'code' || scope === 'md+code') {
    const { refs: scannedRefs } = await commandProjectSession(ctx).codeRefs();
    for (const ref of scannedRefs) {
      const targetLower = ref.target.toLowerCase();
      const matches = isFileLevel
        ? targetLower === fileLower || targetLower.startsWith(fileLower + '#')
        : targetLower === queryLower;
      if (matches) {
        const displayPath = relative(
          process.cwd(),
          join(projectRoot, ref.file),
        );
        codeRefs.push(`${displayPath}:${ref.line}`);
      }
    }
  }

  return { kind: 'found', target, mdRefs, codeRefs };
}

async function findExternalRefs(
  ctx: CmdContext,
  query: string,
  scope: Scope,
): Promise<RefsResult> {
  const external = await commandProjectSession(ctx).external();
  const parsed = external.parse(query)!;
  const target: Section = {
    id: parsed.identity,
    heading: parsed.fragment || parsed.authoredPath,
    depth: 0,
    file: parsed.identity,
    filePath: parsed.identity,
    children: [],
    startLine: 0,
    endLine: 0,
    firstParagraph: '',
  };
  const project = await commandProjectAnalysis(ctx);
  const flat = project.sections;
  const matchingSections = new Set<string>();
  const codeRefs: string[] = [];
  const matchesTarget = (candidate: string): boolean => {
    try {
      return external.parse(candidate)?.identity === parsed.identity;
    } catch {
      return false;
    }
  };
  if (scope !== 'code') {
    for (const file of project.files.values()) {
      for (const ref of file.wikiRefs) {
        if (matchesTarget(ref.target))
          matchingSections.add(ref.fromSection.toLowerCase());
      }
    }
  }
  if (scope !== 'md') {
    for (const ref of (await commandProjectSession(ctx).codeRefs()).refs) {
      if (matchesTarget(ref.target)) {
        codeRefs.push(
          `${relative(process.cwd(), join(ctx.projectRoot, ref.file))}:${ref.line}`,
        );
      }
    }
  }
  return {
    kind: 'found',
    target,
    mdRefs: flat
      .filter((section) => matchingSections.has(section.id.toLowerCase()))
      .map((section) => ({ section, reason: 'wiki link' })),
    codeRefs,
  };
}

/**
 * Find all sections and code locations that reference a given section or
 * source file. Accepts section ids (full-path, short-form) and source file
 * paths (e.g. src/app.rs#foo). Source file queries match wiki links directly
 * without section resolution.
 */
export async function findRefs(
  ctx: CmdContext,
  query: string,
  scope: Scope,
): Promise<RefsResult> {
  query = query.replace(/^\[\[|\]\]$/g, '');

  const external = await commandProjectSession(ctx).external();
  try {
    if (external.parse(query)) return findExternalRefs(ctx, query, scope);
  } catch (error) {
    return {
      kind: 'no-match',
      suggestions: [],
      message: (error as Error).message,
    };
  }
  const unknownExternal = external.unknownTargetMessage(query);
  if (unknownExternal) {
    return { kind: 'no-match', suggestions: [], message: unknownExternal };
  }

  // Source file queries bypass section resolution
  if (isSourceQuery(query, ctx.projectRoot)) {
    return findSourceRefs(ctx, query, scope);
  }

  const project = await commandProjectAnalysis(ctx);
  const { allSections, sections: flat, fileIndex, slugIndex } = project;
  const sectionIds = new Set(project.sectionIds);
  const { resolved } = resolveRef(query, sectionIds, fileIndex, slugIndex);
  const q = resolved.toLowerCase();
  let exactMatch = flat.find((s) => s.id.toLowerCase() === q);

  // If resolveRef didn't land on an exact id, use findSections as fallback
  const matches = !exactMatch ? findSections(allSections, query) : [];
  if (!exactMatch && matches.length >= 1) {
    const top = matches[0];
    const isConfident =
      top.reason === 'exact match' ||
      top.reason.startsWith('file stem expanded') ||
      top.reason === 'section name match';
    if (isConfident) {
      exactMatch = top.section;
    }
  }

  if (!exactMatch) {
    const suggestions =
      matches.length > 0 ? matches : findSections(allSections, query);
    return { kind: 'no-match', suggestions };
  }

  const targetId = exactMatch.id.toLowerCase();
  const mdRefs: SectionMatch[] = [];
  const codeRefs: string[] = [];

  if (scope === 'md' || scope === 'md+code') {
    const matchingFromSections = new Set<string>();
    for (const ref of project.incomingRefsBySection.get(targetId) ?? []) {
      matchingFromSections.add(ref.fromSection.toLowerCase());
    }

    if (matchingFromSections.size > 0) {
      const referrers = flat.filter((s) =>
        matchingFromSections.has(s.id.toLowerCase()),
      );
      for (const s of referrers) {
        mdRefs.push({ section: s, reason: 'wiki link' });
      }
    }
  }

  if (scope === 'code' || scope === 'md+code') {
    const { refs: scannedRefs } = await commandProjectSession(ctx).codeRefs();
    for (const ref of scannedRefs) {
      const { resolved: codeResolved } = resolveRef(
        ref.target,
        sectionIds,
        fileIndex,
        slugIndex,
      );
      if (codeResolved.toLowerCase() === targetId) {
        const displayPath = relative(
          process.cwd(),
          join(ctx.projectRoot, ref.file),
        );
        codeRefs.push(`${displayPath}:${ref.line}`);
      }
    }
  }

  return { kind: 'found', target: exactMatch, mdRefs, codeRefs };
}

export async function refsCommand(
  ctx: CmdContext,
  query: string,
  scope: Scope,
): Promise<CmdResult> {
  const result = await findRefs(ctx, query, scope);

  if (result.kind === 'no-match') {
    const s = ctx.styler;
    if (result.message) {
      return { output: s.red(result.message), isError: true };
    }
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
      output: s.red(`No section matching "${query}"`),
      isError: true,
    };
  }

  const { target, mdRefs, codeRefs } = result;

  if (mdRefs.length === 0 && codeRefs.length === 0) {
    return {
      output: ctx.styler.yellow(`No references to "${target.id}" found`),
      isError: true,
    };
  }

  const s = ctx.styler;
  const parts: string[] = [];
  if (mdRefs.length > 0) {
    parts.push(formatResultList(ctx, `References to "${target.id}":`, mdRefs));
  }

  if (codeRefs.length > 0) {
    parts.push(
      '## Code references:' +
        '\n\n' +
        codeRefs.map((l) => `${s.dim('*')} ${l}`).join('\n'),
    );
  }

  return { output: parts.join('\n') };
}
