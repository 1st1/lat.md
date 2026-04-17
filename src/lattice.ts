import { readFile } from 'node:fs/promises';
import { dirname, join, basename, relative, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { parse } from './parser.js';
import { walkEntries } from './walk.js';
import { visit } from 'unist-util-visit';
import type { Heading, RootContent, Text } from 'mdast';
import type { WikiLink } from './extensions/wiki-link/types.js';
import { parse as parseYaml } from 'yaml';
import type { ExternalSource } from './external-sources.js';

export type Section = {
  id: string;
  heading: string;
  depth: number;
  file: string;
  filePath: string;
  children: Section[];
  startLine: number;
  endLine: number;
  firstParagraph: string;
};

export type Ref = {
  target: string;
  fromSection: string;
  file: string;
  line: number;
};

export type LatFrontmatter = {
  requireCodeMention?: boolean;
  externalSources?: Record<string, ExternalSource>;
};

export function parseFrontmatter(content: string): LatFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    const parsed = parseYaml(match[1]);
    if (!parsed || typeof parsed !== 'object' || !('lat' in parsed)) return {};

    const lat = (parsed as { lat?: Record<string, unknown> }).lat;
    if (!lat || typeof lat !== 'object') return {};

    const result: LatFrontmatter = {};
    if (lat['require-code-mention'] === true) {
      result.requireCodeMention = true;
    }

    const rawExternalSources = lat['external-sources'];
    if (rawExternalSources && typeof rawExternalSources === 'object') {
      const externalSources: Record<string, ExternalSource> = {};
      for (const [handle, value] of Object.entries(rawExternalSources)) {
        if (!value || typeof value !== 'object') continue;
        const source: ExternalSource = {};
        if (typeof value.repo === 'string') source.repo = value.repo;
        if (typeof value.rev === 'string') source.rev = value.rev;
        if (typeof value.browse === 'string') source.browse = value.browse;
        if (typeof value.path === 'string') source.path = value.path;
        externalSources[handle] = source;
      }
      if (Object.keys(externalSources).length > 0) {
        result.externalSources = externalSources;
      }
    }

    return result;
  } catch {
    return {};
  }
}

export function findLatticeDir(from?: string): string | null {
  let dir = resolve(from ?? process.cwd());
  while (true) {
    const candidate = join(dir, 'lat.md');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findProjectRoot(from?: string): string | null {
  const latDir = findLatticeDir(from);
  return latDir ? dirname(latDir) : null;
}

export async function listLatticeFiles(latticeDir: string): Promise<string[]> {
  const entries = await walkEntries(latticeDir);
  return entries
    .filter((e) => e.endsWith('.md'))
    .sort()
    .map((e) => join(latticeDir, e));
}

function headingText(node: Heading): string {
  return node.children
    .filter((c): c is Text => c.type === 'text')
    .map((c) => c.value)
    .join('');
}

function inlineText(node: { children: RootContent[] }): string {
  return node.children
    .map((c) => {
      if (c.type === 'text') return c.value;
      if (c.type === 'inlineCode') return '`' + c.value + '`';
      if (c.type === 'wikiLink') return '[[' + c.value + ']]';
      if ('children' in c) return inlineText(c as { children: RootContent[] });
      return '';
    })
    .join('');
}

function lastLine(content: string): number {
  const lines = content.split('\n');
  // If trailing newline, count doesn't include empty last line
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

export function parseSections(
  filePath: string,
  content: string,
  projectRoot?: string,
): Section[] {
  const tree = parse(content);
  const file = projectRoot
    ? relative(projectRoot, filePath).replace(/\.md$/, '')
    : basename(filePath, '.md');
  const sectionFilePath = projectRoot
    ? relative(projectRoot, filePath)
    : basename(filePath);
  const roots: Section[] = [];
  const stack: Section[] = [];
  const flat: Section[] = [];

  visit(tree, 'heading', (node: Heading) => {
    const heading = headingText(node);
    const depth = node.depth;
    const startLine = node.position!.start.line;

    // Pop stack until we find a parent with smaller depth
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const id = parent ? `${parent.id}#${heading}` : `${file}#${heading}`;

    const section: Section = {
      id,
      heading,
      depth,
      file,
      filePath: sectionFilePath,
      children: [],
      startLine,
      endLine: 0,
      firstParagraph: '',
    };

    if (parent) {
      parent.children.push(section);
    } else {
      roots.push(section);
    }

    stack.push(section);
    flat.push(section);
  });

  // Compute endLine: line before next heading or last line of file
  const fileLastLine = lastLine(content);
  for (let i = 0; i < flat.length; i++) {
    if (i + 1 < flat.length) {
      flat[i].endLine = flat[i + 1].startLine - 1;
    } else {
      flat[i].endLine = fileLastLine;
    }
  }

  // Extract firstParagraph: first paragraph after each heading
  const children = tree.children;
  let headingIdx = 0;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type === 'heading') {
      // Find the first paragraph after this heading, before the next heading
      for (let j = i + 1; j < children.length; j++) {
        if (children[j].type === 'heading') break;
        if (children[j].type === 'paragraph') {
          flat[headingIdx].firstParagraph = inlineText(
            children[j] as unknown as { children: RootContent[] },
          );
          break;
        }
      }
      headingIdx++;
    }
  }

  return roots;
}

export async function loadAllSections(latticeDir: string): Promise<Section[]> {
  const projectRoot = dirname(latticeDir);
  const files = await listLatticeFiles(latticeDir);
  const all: Section[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    all.push(...parseSections(file, content, projectRoot));
  }
  return all;
}

export function flattenSections(sections: Section[]): Section[] {
  const result: Section[] = [];
  for (const s of sections) {
    result.push(s);
    result.push(...flattenSections(s.children));
  }
  return result;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Returns the trailing segment(s) of a section id.
 * e.g. "markdown#Frontmatter#require-code-mention" → ["Frontmatter#require-code-mention", "require-code-mention"]
 * The full id itself is not included (handled by exact match).
 */
function tailSegments(id: string): string[] {
  const parts = id.split('#');
  const tails: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    tails.push(parts.slice(i).join('#'));
  }
  return tails;
}

/**
 * Build an index mapping path suffixes to their full vault-relative paths.
 * Used by resolveRef to allow short references when a suffix is unambiguous.
 *
 * For a file like `lat.md/guides/setup`, indexes both `guides/setup` and `setup`.
 * This ensures backward-compatible short refs after the vault root moved to the
 * project root (so section IDs now include the `lat.md/` prefix).
 */
export function buildFileIndex(sections: Section[]): Map<string, string[]> {
  const flat = flattenSections(sections);
  const index = new Map<string, Set<string>>();
  for (const s of flat) {
    const parts = s.file.split('/');
    // Index all trailing path suffixes (excluding the full path itself,
    // which is handled by exact match). Keys are lowercase for
    // case-insensitive lookup.
    for (let i = 1; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/').toLowerCase();
      if (!index.has(suffix)) index.set(suffix, new Set());
      index.get(suffix)!.add(s.file);
    }
  }
  const result = new Map<string, string[]>();
  for (const [stem, paths] of index) {
    result.set(stem, [...paths]);
  }
  return result;
}

export type ResolveResult = {
  resolved: string;
  ambiguous: string[] | null;
  /** When ambiguous but exactly one candidate has the section, suggest it. */
  suggested: string | null;
};

/**
 * Resolve a potentially short reference to its canonical full-path form.
 * If the file segment of the ref is a bare stem that uniquely maps to one
 * full path, expands it. Otherwise returns the ref unchanged.
 *
 * When ambiguous (multiple files share the stem), returns all candidates.
 * If exactly one candidate actually contains the referenced section,
 * `suggested` is set to that candidate so the caller can propose a fix.
 */
export function resolveRef(
  target: string,
  sectionIds: Set<string>,
  fileIndex: Map<string, string[]>,
): ResolveResult {
  // Already matches a known section — no resolution needed
  if (sectionIds.has(target.toLowerCase())) {
    return { resolved: target, ambiguous: null, suggested: null };
  }

  // Extract the file segment (before first #) and try resolving it
  const hashIdx = target.indexOf('#');
  const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
  const rest = hashIdx === -1 ? '' : target.slice(hashIdx);

  // Try resolving the file part: either it's a full path or a bare stem
  // File index keys are lowercase for case-insensitive lookup.
  const lcFilePart = filePart.toLowerCase();
  const filePaths = fileIndex.has(lcFilePart)
    ? fileIndex.get(lcFilePart)!
    : [filePart];

  if (filePaths.length === 1) {
    const fp = filePaths[0];
    const expanded = fp + rest;
    if (sectionIds.has(expanded.toLowerCase())) {
      return { resolved: expanded, ambiguous: null, suggested: null };
    }
    // Try inserting root headings between file and rest.
    // Handles Obsidian-style file#heading refs where the h1 is implicit.
    const rootHeadings = findRootHeadings(fp, sectionIds);
    for (const h1 of rootHeadings) {
      const withRoot = rest ? `${fp}#${h1}${rest}` : `${fp}#${h1}`;
      if (sectionIds.has(withRoot.toLowerCase())) {
        return { resolved: withRoot, ambiguous: null, suggested: null };
      }
    }
  } else if (filePaths.length > 1) {
    // Multiple files share this stem — ambiguous at the filename level
    const all = filePaths.map((c) => c + rest);
    const valid = filePaths.filter((c) => {
      if (sectionIds.has((c + rest).toLowerCase())) return true;
      // Also try with root heading insertion
      const rootHeadings = findRootHeadings(c, sectionIds);
      return rootHeadings.some((h1) => {
        const withRoot = rest ? `${c}#${h1}${rest}` : `${c}#${h1}`;
        return sectionIds.has(withRoot.toLowerCase());
      });
    });
    return {
      resolved: target,
      ambiguous: all,
      suggested: valid.length === 1 ? valid[0] + rest : null,
    };
  }

  return { resolved: target, ambiguous: null, suggested: null };
}

/**
 * Find root (h1) headings for a file by scanning sectionIds for entries
 * that have exactly the pattern `file#heading` (no further # segments).
 */
function findRootHeadings(file: string, sectionIds: Set<string>): string[] {
  const prefix = file.toLowerCase() + '#';
  const headings: string[] = [];
  for (const id of sectionIds) {
    if (id.startsWith(prefix) && !id.includes('#', prefix.length)) {
      headings.push(id.slice(prefix.length));
    }
  }
  return headings;
}

const MAX_DISTANCE_RATIO = 0.4;

export type SectionMatch = {
  section: Section;
  reason: string;
};

export function findSections(
  sections: Section[],
  query: string,
): SectionMatch[] {
  const flat = flattenSections(sections);
  // Leading # means "search for a heading", strip it
  const normalized = query.startsWith('#') ? query.slice(1) : query;
  const q = normalized.toLowerCase();
  const isFullPath = normalized.includes('#');

  // Tier 1: exact full-id match
  const exact = flat.filter((s) => s.id.toLowerCase() === q);
  const exactMatches: SectionMatch[] = exact.map((s) => ({
    section: s,
    reason: 'exact match',
  }));
  if (exactMatches.length > 0 && isFullPath) return exactMatches;

  // Build file index early — used by both tier 1a and 1b
  const fileIndex = buildFileIndex(sections);

  // Tier 1a: bare name matches file — return root sections of that file
  // Also checks via file index (e.g. "dev-process" → "lat.md/dev-process")
  if (!isFullPath && exactMatches.length === 0) {
    const matchFiles = new Set<string>();
    // Direct match
    for (const s of flat) {
      if (
        s.file.toLowerCase() === q &&
        !s.id.includes('#', s.file.length + 1)
      ) {
        matchFiles.add(s.file);
      }
    }
    // File index expansion (keys are lowercase)
    const indexPaths = fileIndex.get(q) ?? [];
    for (const p of indexPaths) {
      matchFiles.add(p);
    }
    if (matchFiles.size > 0) {
      const fileRoots = flat.filter(
        (s) => matchFiles.has(s.file) && !s.id.includes('#', s.file.length + 1),
      );
      if (fileRoots.length > 0) {
        return fileRoots.map((s) => ({
          section: s,
          reason: 'exact match',
        }));
      }
    }
  }

  // Tier 1b: file stem expansion
  // For bare names: "locate" → matches root section of "tests/locate.md"
  // For paths with #: "setup#Install" → expands to "guides/setup#Install"
  const stemMatches: SectionMatch[] = [];
  if (isFullPath) {
    // Expand file stem in the file part of the query
    const hashIdx = normalized.indexOf('#');
    const filePart = normalized.slice(0, hashIdx);
    const rest = normalized.slice(hashIdx);
    const stemPaths = fileIndex.get(filePart.toLowerCase()) ?? [];
    // Also try filePart as a direct file path (for root-level files not in index)
    const allPaths =
      stemPaths.length > 0 ? stemPaths : filePart ? [filePart] : [];
    for (const p of allPaths) {
      const expanded = (p + rest).toLowerCase();
      const s = flat.find(
        (s) => s.id.toLowerCase() === expanded && !exact.includes(s),
      );
      if (s) {
        stemMatches.push({
          section: s,
          reason:
            stemPaths.length > 0
              ? `file stem expanded: ${filePart} → ${p}`
              : 'exact match',
        });
        continue;
      }
      // Try inserting root headings: file#rest → file#h1#rest
      const rootsOfFile = flat.filter(
        (s) =>
          s.file.toLowerCase() === p.toLowerCase() &&
          !s.id.includes('#', s.file.length + 1),
      );
      for (const root of rootsOfFile) {
        const withRoot = (root.id + rest).toLowerCase();
        const match = flat.find(
          (s) => s.id.toLowerCase() === withRoot && !exact.includes(s),
        );
        if (match) {
          stemMatches.push({
            section: match,
            reason:
              stemPaths.length > 0
                ? `file stem expanded: ${filePart} → ${p}`
                : 'exact match',
          });
        }
      }
    }
    if (stemMatches.length > 0) return [...exactMatches, ...stemMatches];
  } else {
    // Bare name: match root sections of files via stem index (keys lowercase)
    const paths = fileIndex.get(q) ?? [];
    for (const p of paths) {
      for (const s of flat) {
        if (exact.includes(s)) continue;
        // Root sections have id = "file#heading" (exactly 2 segments)
        if (
          s.file.toLowerCase() === p.toLowerCase() &&
          !s.id.includes('#', s.file.length + 1)
        ) {
          stemMatches.push({ section: s, reason: 'file stem match' });
        }
      }
    }
  }

  // Tier 2: exact match on trailing segments (subsection name match)
  const seen = new Set([
    ...exact.map((s) => s.id),
    ...stemMatches.map((m) => m.section.id),
  ]);
  const subsection: SectionMatch[] = isFullPath
    ? []
    : flat
        .filter((s) => {
          if (seen.has(s.id)) return false;
          return tailSegments(s.id).some((tail) => tail.toLowerCase() === q);
        })
        .map((s) => ({ section: s, reason: 'section name match' }));

  // Tier 2b: subsequence match — query segments are a subsequence of section id segments
  // e.g. "Markdown#Resolution Rules" matches "markdown#Wiki Links#Resolution Rules"
  // Also tries expanding the file part via the file index for short refs.
  const seenSub = new Set([...seen, ...subsection.map((m) => m.section.id)]);
  const qParts = q.split('#');
  // Build query variants: original + file-index-expanded forms
  const qVariants: string[][] = [qParts];
  if (qParts.length >= 2) {
    const expanded = fileIndex.get(qParts[0]);
    if (expanded) {
      for (const exp of expanded) {
        qVariants.push([exp.toLowerCase(), ...qParts.slice(1)]);
      }
    }
  }
  const subsequence: SectionMatch[] =
    qParts.length >= 2
      ? flat
          .filter((s) => {
            if (seenSub.has(s.id)) return false;
            const sParts = s.id.toLowerCase().split('#');
            return qVariants.some((variant) => {
              if (sParts.length <= variant.length) return false;
              let qi = 0;
              for (const sp of sParts) {
                if (sp === variant[qi]) qi++;
                if (qi === variant.length) return true;
              }
              return false;
            });
          })
          .map((s) => {
            const skipped = s.id.split('#').length - qParts.length;
            return {
              section: s,
              reason: `path match, ${skipped} intermediate ${skipped === 1 ? 'section' : 'sections'} skipped`,
            };
          })
      : [];

  // Tier 3: fuzzy match by edit distance on each segment tail and full id
  const seenAll = new Set([
    ...seenSub,
    ...subsequence.map((m) => m.section.id),
  ]);
  const fuzzy: { section: Section; distance: number; matched: string }[] = [];

  // For full-path queries, extract the file and heading parts so we can
  // fuzzy-match only the heading portion when the file part matches exactly.
  // This prevents the shared file prefix from inflating similarity scores
  // (e.g. "cli#locat" would otherwise fuzzy-match "cli#prompt").
  const qHashIdx = normalized.indexOf('#');
  const qFile =
    qHashIdx === -1 ? null : normalized.slice(0, qHashIdx).toLowerCase();
  const qHeading =
    qHashIdx === -1 ? null : normalized.slice(qHashIdx + 1).toLowerCase();

  for (const s of flat) {
    if (seenAll.has(s.id)) continue;
    const candidates = [s.id, ...tailSegments(s.id)];
    let best = Infinity;
    let bestCandidate = '';
    for (const c of candidates) {
      let d: number;
      let maxLen: number;
      const cl = c.toLowerCase();
      const cHashIdx = cl.indexOf('#');

      // When both query and candidate have # and their file parts match,
      // compare only the heading portions to avoid file-prefix inflation
      if (qFile && qHeading && cHashIdx !== -1) {
        const cFile = cl.slice(0, cHashIdx);
        const cHeading = cl.slice(cHashIdx + 1);
        if (cFile === qFile) {
          d = levenshtein(cHeading, qHeading);
          maxLen = Math.max(cHeading.length, qHeading.length);
        } else {
          d = levenshtein(cl, q);
          maxLen = Math.max(c.length, q.length);
        }
      } else {
        d = levenshtein(cl, q);
        maxLen = Math.max(c.length, q.length);
      }

      if (maxLen > 0 && d / maxLen <= MAX_DISTANCE_RATIO && d < best) {
        best = d;
        bestCandidate = c;
      }
    }
    if (best < Infinity) {
      fuzzy.push({ section: s, distance: best, matched: bestCandidate });
    }
  }
  fuzzy.sort((a, b) => a.distance - b.distance);

  const fuzzyMatches: SectionMatch[] = fuzzy.map((f) => ({
    section: f.section,
    reason:
      f.matched.toLowerCase() === f.section.id.toLowerCase()
        ? `fuzzy match, distance ${f.distance}`
        : `fuzzy match on "${f.matched}", distance ${f.distance}`,
  }));

  // Sort results: shallower depth first, then fewer path segments
  const sortKey = (s: Section) => {
    const pathDepth = (s.file.match(/\//g) || []).length;
    return s.depth * 100 + pathDepth;
  };

  const sortedStems = [...stemMatches].sort(
    (a, b) => sortKey(a.section) - sortKey(b.section),
  );

  return [
    ...exactMatches,
    ...sortedStems,
    ...subsection,
    ...subsequence,
    ...fuzzyMatches,
  ];
}

export function extractRefs(
  filePath: string,
  content: string,
  projectRoot?: string,
): Ref[] {
  const tree = parse(content);
  const file = projectRoot
    ? relative(projectRoot, filePath).replace(/\.md$/, '')
    : basename(filePath, '.md');
  const refs: Ref[] = [];

  // Build a flat list of sections to determine enclosing section for each wiki link
  const flat: { id: string; startLine: number }[] = [];
  visit(tree, 'heading', (node: Heading) => {
    flat.push({
      id: '', // filled below
      startLine: node.position!.start.line,
    });
  });

  // Re-derive ids using the same logic as parseSections
  const stack: { id: string; depth: number }[] = [];
  let idx = 0;
  visit(tree, 'heading', (node: Heading) => {
    const heading = headingText(node);
    const depth = node.depth;
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const id = parent ? `${parent.id}#${heading}` : `${file}#${heading}`;
    flat[idx].id = id;
    stack.push({ id, depth });
    idx++;
  });

  visit(tree, 'wikiLink', (node: WikiLink) => {
    const line = node.position!.start.line;

    // Find enclosing section: last heading with startLine <= link line
    let fromSection = '';
    for (const s of flat) {
      if (s.startLine <= line) {
        fromSection = s.id;
      } else {
        break;
      }
    }

    refs.push({
      target: node.value,
      fromSection,
      file,
      line,
    });
  });

  return refs;
}
