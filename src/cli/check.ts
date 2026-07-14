import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import {
  listLatticeFiles,
  loadAllSections,
  extractRefs,
  flattenSections,
  parseFrontmatter,
  parseSections,
  buildFileIndex,
  resolveRef,
  type Section,
} from '../lattice.js';
import { scanCodeRefs } from '../code-refs.js';
import { SOURCE_EXTENSIONS, clearSymbolCache } from '../source-parser.js';
import { walkEntries } from '../walk.js';
import type { CmdContext, CmdResult, Styler } from '../context.js';
import { INIT_VERSION, readInitVersion } from '../init-version.js';

export type CheckError = {
  file: string;
  line: number;
  target: string;
  message: string;
};

function filePart(id: string): string {
  const h = id.indexOf('#');
  return h === -1 ? id : id.slice(0, h);
}

/** Format an ambiguous-ref error as structured markdown-like text. */
function ambiguousMessage(
  target: string,
  candidates: string[],
  suggested: string | null,
): string {
  const shortName = filePart(target);
  const fileList = candidates.map((c) => `  - "${filePart(c)}.md"`).join('\n');
  const lines: string[] = [];

  if (suggested) {
    lines.push(
      `ambiguous link '[[${target}]]' — did you mean '[[${suggested}]]'?`,
    );
  } else {
    const options = candidates.map((a) => `'[[${a}]]'`).join(', ');
    lines.push(
      `ambiguous link '[[${target}]]' — multiple paths match, use either of: ${options}`,
    );
  }

  lines.push(
    `  The short path "${shortName}" is ambiguous — ${candidates.length} files match:`,
    fileList,
    `  Please fix the link to use a fully qualified path.`,
  );
  return lines.join('\n');
}

/** File counts grouped by extension (e.g. { ".ts": 5, ".py": 2 }). */
export type FileStats = Record<string, number>;

export type CheckResult = {
  errors: CheckError[];
  files: FileStats;
};

function countByExt(paths: string[]): FileStats {
  const stats: FileStats = {};
  for (const p of paths) {
    const ext = extname(p) || '(no ext)';
    stats[ext] = (stats[ext] || 0) + 1;
  }
  return stats;
}

function isSourcePath(target: string): boolean {
  const hashIdx = target.indexOf('#');
  const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
  const ext = extname(filePart);
  return SOURCE_EXTENSIONS.has(ext);
}

/**
 * Try resolving a wiki link target as a source code reference.
 * Returns null if the reference is valid, or an error message string.
 */
async function tryResolveSourceRef(
  target: string,
  projectRoot: string,
): Promise<string | null> {
  if (!isSourcePath(target)) {
    // Check if it looks like a file path with an unsupported extension
    const hashIdx = target.indexOf('#');
    const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
    const ext = extname(filePart);
    if (ext && hashIdx !== -1) {
      const supported = [...SOURCE_EXTENSIONS].sort().join(', ');
      return `broken link [[${target}]] — unsupported file extension "${ext}". Supported: ${supported}`;
    }
    return `broken link [[${target}]] — no matching section found`;
  }

  const hashIdx = target.indexOf('#');
  const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
  const symbolPart = hashIdx === -1 ? '' : target.slice(hashIdx + 1);

  const absPath = join(projectRoot, filePart);
  if (!existsSync(absPath)) {
    return `broken link [[${target}]] — file "${filePart}" not found`;
  }

  if (!symbolPart) {
    // File-only link with no symbol — valid as long as file exists
    return null;
  }

  try {
    const { resolveSourceSymbol } = await import('../source-parser.js');
    const { found, error } = await resolveSourceSymbol(
      filePart,
      symbolPart,
      projectRoot,
    );
    if (error) {
      return `broken link [[${target}]] — ${error}`;
    }
    if (!found) {
      return `broken link [[${target}]] — symbol "${symbolPart}" not found in "${filePart}"`;
    }
    return null;
  } catch (err) {
    return `broken link [[${target}]] — failed to parse "${filePart}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function checkMd(latticeDir: string): Promise<CheckResult> {
  clearSymbolCache();
  const projectRoot = dirname(latticeDir);
  const files = await listLatticeFiles(latticeDir);
  const allSections = await loadAllSections(latticeDir);
  const flat = flattenSections(allSections);
  const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
  const fileIndex = buildFileIndex(allSections);

  const errors: CheckError[] = [];

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const refs = extractRefs(file, content, projectRoot);
    const relPath = relative(process.cwd(), file);

    for (const ref of refs) {
      const { resolved, ambiguous, suggested } = resolveRef(
        ref.target,
        sectionIds,
        fileIndex,
      );
      if (ambiguous) {
        errors.push({
          file: relPath,
          line: ref.line,
          target: ref.target,
          message: ambiguousMessage(ref.target, ambiguous, suggested),
        });
      } else if (!sectionIds.has(resolved.toLowerCase())) {
        // Try resolving as a source code reference (e.g. [[src/foo.ts#bar]])
        const sourceErr = await tryResolveSourceRef(ref.target, projectRoot);
        if (sourceErr !== null) {
          errors.push({
            file: relPath,
            line: ref.line,
            target: ref.target,
            message: sourceErr,
          });
        }
      }
    }
  }

  return { errors, files: countByExt(files) };
}

export async function checkCodeRefs(latticeDir: string): Promise<CheckResult> {
  const projectRoot = dirname(latticeDir);
  const allSections = await loadAllSections(latticeDir);
  const flat = flattenSections(allSections);
  const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
  const fileIndex = buildFileIndex(allSections);

  const scan = await scanCodeRefs(projectRoot);
  const errors: CheckError[] = [];

  const mentionedSections = new Set<string>();
  for (const ref of scan.refs) {
    const { resolved, ambiguous, suggested } = resolveRef(
      ref.target,
      sectionIds,
      fileIndex,
    );
    mentionedSections.add(resolved.toLowerCase());
    const displayPath = relative(process.cwd(), join(projectRoot, ref.file));
    if (ambiguous) {
      errors.push({
        file: displayPath,
        line: ref.line,
        target: ref.target,
        message: ambiguousMessage(ref.target, ambiguous, suggested),
      });
    } else if (!sectionIds.has(resolved.toLowerCase())) {
      errors.push({
        file: displayPath,
        line: ref.line,
        target: ref.target,
        message: `@lat: [[${ref.target}]] — no matching section found`,
      });
    }
  }

  const files = await listLatticeFiles(latticeDir);
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm.requireCodeMention) continue;

    const sections = parseSections(file, content, projectRoot);
    const fileSections = flattenSections(sections);
    const leafSections = fileSections.filter((s) => s.children.length === 0);
    const relPath = relative(process.cwd(), file);

    for (const leaf of leafSections) {
      if (!mentionedSections.has(leaf.id.toLowerCase())) {
        errors.push({
          file: relPath,
          line: leaf.startLine,
          target: leaf.id,
          message: `section "${leaf.id}" requires a code mention but none found`,
        });
      }
    }
  }

  return { errors, files: countByExt(scan.files) };
}

/**
 * Extract the immediate (first-level) entries from walkEntries results.
 * Returns unique file and directory names visible in a given directory.
 */
function immediateEntries(walkedPaths: string[]): string[] {
  const entries = new Set<string>();
  for (const p of walkedPaths) {
    const slash = p.indexOf('/');
    entries.add(slash === -1 ? p : p.slice(0, slash));
  }
  return [...entries].sort();
}

/** Parse bullet items from an index file. Matches `- [[name]] — description` */
function parseIndexEntries(content: string): Set<string> {
  const names = new Set<string>();
  const re = /^- \[\[([^\]]+?)(?:\|[^\]]+)?\]\]/gm;
  let match;
  while ((match = re.exec(content)) !== null) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Convert a filesystem entry name to its wiki link stem.
 * Strips `.md` extension from files; directories stay as-is.
 */
function entryToStem(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/** Generate a bullet-list snippet for the given entry names. */
function indexSnippet(entries: string[]): string {
  return entries.map((e) => `- [[${entryToStem(e)}]] — <describe>`).join('\n');
}

export type IndexError = {
  dir: string;
  message: string;
  snippet?: string;
};

export async function checkIndex(latticeDir: string): Promise<IndexError[]> {
  const errors: IndexError[] = [];
  const allPaths = await walkEntries(latticeDir);

  // Flag non-.md files — only markdown belongs in lat.md/
  for (const p of allPaths) {
    const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    if (!name.endsWith('.md')) {
      const relDir = basename(latticeDir) + '/';
      errors.push({
        dir: relDir,
        message: `"${p}" is not a .md file — only markdown files belong in lat.md/`,
      });
    }
  }

  // Only .md files participate in index validation
  const mdPaths = allPaths.filter((p) => p.endsWith('.md'));

  // Collect all directories to check (including root, represented as '')
  const dirs = new Set<string>(['']);
  for (const p of mdPaths) {
    const parts = p.split('/');
    // Add every directory prefix
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }

  for (const dir of dirs) {
    // Determine the index file name and its expected path.
    // The index file shares the directory's name — for `lat.md/` it's `lat.md`,
    // for a subdir `api/` it's `api.md`.
    const dirName = dir === '' ? basename(latticeDir) : dir.split('/').pop()!;
    const indexFileName = dirName.endsWith('.md') ? dirName : dirName + '.md';
    const indexRelPath = dir === '' ? indexFileName : dir + '/' + indexFileName;

    // Get the immediate children of this directory
    const prefix = dir === '' ? '' : dir + '/';
    const childPaths = mdPaths
      .filter((p) => p.startsWith(prefix) && p !== indexRelPath)
      .map((p) => p.slice(prefix.length));
    const children = immediateEntries(childPaths);

    if (children.length === 0) continue;

    // Check if the index file exists
    const indexFullPath = join(latticeDir, indexRelPath);
    let content: string;
    try {
      content = await readFile(indexFullPath, 'utf-8');
    } catch {
      const relDir = dir === '' ? basename(latticeDir) + '/' : dir + '/';
      errors.push({
        dir: relDir,
        message: `missing index file "${indexRelPath}" — create it with a directory listing:\n\n${indexSnippet(children)}`,
        snippet: indexSnippet(children),
      });
      continue;
    }

    // Parse existing entries and validate.
    // Listed entries are wiki link stems (no .md extension).
    // Children are filesystem names (with .md for files, bare for dirs).
    const listed = parseIndexEntries(content);
    const childStems = new Set(children.map(entryToStem));
    const stemToChild = new Map(children.map((c) => [entryToStem(c), c]));
    const relDir = dir === '' ? basename(latticeDir) + '/' : dir + '/';
    const missing: string[] = [];

    for (const child of children) {
      if (!listed.has(entryToStem(child))) {
        missing.push(child);
      }
    }

    if (missing.length > 0) {
      errors.push({
        dir: relDir,
        message: `"${indexRelPath}" is missing entries — add:\n\n${indexSnippet(missing)}`,
        snippet: indexSnippet(missing),
      });
    }

    const indexStem = entryToStem(indexFileName);
    for (const name of listed) {
      if (!childStems.has(name) && name !== indexStem) {
        errors.push({
          dir: relDir,
          message: `"${indexRelPath}" lists "[[${name}]]" but it does not exist`,
        });
      }
    }
  }

  return errors;
}

// --- Section structure validation ---

/** Max characters for the first paragraph of a section (excluding [[wiki links]]). */
const MAX_BODY_LENGTH = 250;

/** Count body text length excluding `[[...]]` wiki link markers and content. */
function bodyTextLength(body: string): number {
  return body.replace(/\[\[[^\]]*\]\]/g, '').length;
}

export async function checkSections(latticeDir: string): Promise<CheckError[]> {
  const projectRoot = dirname(latticeDir);
  const files = await listLatticeFiles(latticeDir);
  const errors: CheckError[] = [];

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const sections = parseSections(file, content, projectRoot);
    const flat = flattenSections(sections);
    const relPath = relative(process.cwd(), file);

    for (const section of flat) {
      if (!section.firstParagraph) {
        errors.push({
          file: relPath,
          line: section.startLine,
          target: section.id,
          message:
            `section "${section.id}" has no leading paragraph. ` +
            `Every section must start with a brief overview (≤${MAX_BODY_LENGTH} chars) ` +
            `summarizing what it documents — this powers search snippets and command output.`,
        });
        continue;
      }

      const len = bodyTextLength(section.firstParagraph);
      if (len > MAX_BODY_LENGTH) {
        errors.push({
          file: relPath,
          line: section.startLine,
          target: section.id,
          message:
            `section "${section.id}" leading paragraph is ${len} characters ` +
            `(max ${MAX_BODY_LENGTH}, excluding [[wiki links]]). ` +
            `Keep the first paragraph brief — it serves as the section's summary ` +
            `in search results and command output. Use subsequent paragraphs for details.`,
        });
      }
    }
  }

  return errors;
}

// --- Formatting helpers (shared by all check commands) ---

function formatFileStats(files: FileStats, s: Styler): string {
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  return s.dim(
    `Scanned ${entries.map(([ext, n]) => `${n} ${ext}`).join(', ')}`,
  );
}

function formatCheckErrors(errors: CheckError[], s: Styler): string[] {
  const lines: string[] = [];
  for (const err of errors) {
    lines.push('');
    const loc = s.cyan(err.file + ':' + err.line);
    const [first, ...rest] = err.message.split('\n');
    lines.push(`- ${loc}: ${s.red(first)}`);
    for (const line of rest) {
      lines.push(`  ${s.red(line)}`);
    }
  }
  return lines;
}

function formatCheckIndexErrors(errors: IndexError[], s: Styler): string[] {
  const lines: string[] = [];
  for (const err of errors) {
    lines.push('');
    const loc = s.cyan(err.dir);
    const [first, ...rest] = err.message.split('\n');
    lines.push(`- ${loc}: ${s.red(first)}`);
    for (const line of rest) {
      lines.push(`  ${s.red(line)}`);
    }
  }
  return lines;
}

function formatErrorCount(count: number, s: Styler): string {
  return s.red(`\n${count} error${count === 1 ? '' : 's'} found`);
}

// --- Unified command functions ---

export async function checkAllCommand(ctx: CmdContext): Promise<CmdResult> {
  const startTime = Date.now();
  const md = await checkMd(ctx.latDir);
  const code = await checkCodeRefs(ctx.latDir);
  const indexErrors = await checkIndex(ctx.latDir);
  const sectionErrors = await checkSections(ctx.latDir);
  const elapsed = Date.now() - startTime;

  const allErrors = [...md.errors, ...code.errors];
  const allFiles: FileStats = { ...md.files };
  for (const [ext, n] of Object.entries(code.files)) {
    allFiles[ext] = (allFiles[ext] || 0) + n;
  }

  const s = ctx.styler;
  const elapsedStr =
    elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
  const lines: string[] = [
    formatFileStats(allFiles, s) + s.dim(` in ${elapsedStr}`),
  ];

  // Init version warning first — user should fix setup before addressing errors
  const storedVersion = readInitVersion(ctx.latDir);
  if (storedVersion === null) {
    lines.push(
      '',
      s.yellow('Warning:') +
        ' No init version recorded — run ' +
        s.cyan('lat init') +
        ' to set up agent hooks and configuration.',
    );
  } else if (storedVersion < INIT_VERSION) {
    lines.push(
      '',
      s.yellow('Warning:') +
        ' Your setup is outdated (v' +
        storedVersion +
        ' → v' +
        INIT_VERSION +
        '). Re-run ' +
        s.cyan('lat init') +
        ' to update agent hooks and configuration.',
    );
  }

  lines.push(...formatCheckErrors(allErrors, s));
  lines.push(...formatCheckIndexErrors(indexErrors, s));
  lines.push(...formatCheckErrors(sectionErrors, s));

  const totalErrors =
    allErrors.length + indexErrors.length + sectionErrors.length;
  if (totalErrors > 0) {
    lines.push(formatErrorCount(totalErrors, s));
    return { output: lines.join('\n'), isError: true };
  }

  lines.push(s.green('All checks passed'));

  // Suggest ripgrep if check was slow (>1s) and rg is not available
  if (elapsed > 1000) {
    const { hasRipgrep } = await import('../code-refs.js');
    if (!(await hasRipgrep())) {
      lines.push(
        s.yellow('Tip:') +
          ' Install ' +
          s.cyan('ripgrep') +
          ' (rg) for faster code scanning.' +
          ' See https://github.com/BurntSushi/ripgrep#installation',
      );
    }
  }

  return { output: lines.join('\n') };
}

export async function checkMdCommand(ctx: CmdContext): Promise<CmdResult> {
  const { errors, files } = await checkMd(ctx.latDir);
  const s = ctx.styler;
  const lines: string[] = [formatFileStats(files, s)];

  lines.push(...formatCheckErrors(errors, s));

  if (errors.length > 0) {
    lines.push(formatErrorCount(errors.length, s));
    return { output: lines.join('\n'), isError: true };
  }

  lines.push(s.green('md: All links OK'));
  return { output: lines.join('\n') };
}

export async function checkCodeRefsCommand(
  ctx: CmdContext,
): Promise<CmdResult> {
  const { errors, files } = await checkCodeRefs(ctx.latDir);
  const s = ctx.styler;
  const lines: string[] = [formatFileStats(files, s)];

  lines.push(...formatCheckErrors(errors, s));

  if (errors.length > 0) {
    lines.push(formatErrorCount(errors.length, s));
    return { output: lines.join('\n'), isError: true };
  }

  lines.push(s.green('code-refs: All references OK'));
  return { output: lines.join('\n') };
}

export async function checkIndexCommand(ctx: CmdContext): Promise<CmdResult> {
  const errors = await checkIndex(ctx.latDir);
  const s = ctx.styler;
  const lines: string[] = [];

  lines.push(...formatCheckIndexErrors(errors, s));

  if (errors.length > 0) {
    lines.push(formatErrorCount(errors.length, s));
    return { output: lines.join('\n'), isError: true };
  }

  lines.push(s.green('index: All directory index files OK'));
  return { output: lines.join('\n') };
}

export async function checkSectionsCommand(
  ctx: CmdContext,
): Promise<CmdResult> {
  const errors = await checkSections(ctx.latDir);
  const s = ctx.styler;
  const lines: string[] = [];

  lines.push(...formatCheckErrors(errors, s));

  if (errors.length > 0) {
    lines.push(formatErrorCount(errors.length, s));
    return { output: lines.join('\n'), isError: true };
  }

  lines.push(s.green('sections: All sections have valid leading paragraphs'));
  return { output: lines.join('\n') };
}
