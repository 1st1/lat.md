import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import {
  listLatticeFiles,
  loadAllSections,
  findSections,
  extractRefs,
  flattenSections,
  buildFileIndex,
  buildSectionSlugIndex,
  resolveRef,
  type Section,
  type SectionMatch,
} from '../lattice.js';
import { formatResultList } from '../format.js';
import { scanCodeRefs } from '../code-refs.js';
import type { CmdContext, CmdResult } from '../context.js';
import {
  loadExternalSources,
  parseExternalTarget,
} from '../external-sources.js';

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
};

export type RefsResult = RefsFound | RefsError;

/** Extensions recognized as source code for ref queries. */
const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.c',
  '.h',
]);

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
  if (!SOURCE_EXTS.has(ext)) return null;
  if (!existsSync(join(projectRoot, filePart))) return null;
  return { filePart, symbolPart };
}

/**
 * Find references to a source file or symbol across lat.md and code files.
 * For file-level queries (no #symbol), matches all wiki links targeting
 * that file or any symbol in it.
 */
async function findSourceRefs(
  latDir: string,
  projectRoot: string,
  query: string,
  scope: Scope,
): Promise<RefsResult> {
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

  const allSections = await loadAllSections(latDir);
  const flat = flattenSections(allSections);
  const mdRefs: SectionMatch[] = [];
  const codeRefs: string[] = [];

  if (scope === 'md' || scope === 'md+code') {
    const files = await listLatticeFiles(latDir);
    const matchingFromSections = new Set<string>();
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const fileRefs = extractRefs(file, content, projectRoot);
      for (const ref of fileRefs) {
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
    const { refs: scannedRefs } = await scanCodeRefs(projectRoot);
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
  latDir: string,
  projectRoot: string,
  query: string,
  scope: Scope,
): Promise<RefsResult> {
  const colonIdx = query.indexOf(':');
  const target: Section = {
    id: query,
    heading: colonIdx === -1 ? query : query.slice(colonIdx + 1),
    depth: 0,
    file: query,
    filePath: query,
    children: [],
    startLine: 0,
    endLine: 0,
    firstParagraph: '',
  };

  const allSections = await loadAllSections(latDir);
  const flat = flattenSections(allSections);
  const mdRefs: SectionMatch[] = [];
  const codeRefs: string[] = [];
  const queryLower = query.toLowerCase();

  if (scope === 'md' || scope === 'md+code') {
    const files = await listLatticeFiles(latDir);
    const matchingFromSections = new Set<string>();
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const fileRefs = extractRefs(file, content, projectRoot);
      for (const ref of fileRefs) {
        if (ref.target.toLowerCase() === queryLower) {
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
    const { refs: scannedRefs } = await scanCodeRefs(projectRoot);
    for (const ref of scannedRefs) {
      if (ref.target.toLowerCase() === queryLower) {
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
  const externalSources = loadExternalSources(ctx.projectRoot);

  if (parseExternalTarget(query, externalSources.sources)) {
    return findExternalRefs(ctx.latDir, ctx.projectRoot, query, scope);
  }

  // Source file queries bypass section resolution
  if (isSourceQuery(query, ctx.projectRoot)) {
    return findSourceRefs(ctx.latDir, ctx.projectRoot, query, scope);
  }

  const allSections = await loadAllSections(ctx.latDir);
  const flat = flattenSections(allSections);
  const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
  const fileIndex = buildFileIndex(allSections);
  const slugIndex = buildSectionSlugIndex(allSections);
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
    const files = await listLatticeFiles(ctx.latDir);
    const matchingFromSections = new Set<string>();
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const fileRefs = extractRefs(file, content, ctx.projectRoot);
      for (const ref of fileRefs) {
        const { resolved: refResolved } = resolveRef(
          ref.target,
          sectionIds,
          fileIndex,
          slugIndex,
        );
        if (refResolved.toLowerCase() === targetId) {
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
    const { refs: scannedRefs } = await scanCodeRefs(ctx.projectRoot);
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
