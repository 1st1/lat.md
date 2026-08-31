import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { flattenSections, resolveRef } from '../lattice.js';
import type { ResolveSourceSymbolOptions } from '../source-parser.js';
import {
  isSourceFileExtension,
  SOURCE_FILE_EXTENSIONS,
} from '../source-formats.js';
import { toPosix } from '../walk.js';
import { TimingProfiler, type Profiler } from '../profiler.js';
import type { CmdContext, CmdResult, Styler } from '../context.js';
import { INIT_VERSION, readInitVersion } from '../init-version.js';
import { CheckRunContext } from './check-context.js';
import { parseLocalMarkdownTarget } from '../markdown-validation.js';

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
export function ambiguousRefMessage(
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

async function profileTime<T>(
  profile: Profiler | undefined,
  label: string,
  work: () => Promise<T>,
  detail?: string,
): Promise<T> {
  return profile ? profile.time(label, work, detail) : work();
}

function profileTimeSync<T>(
  profile: Profiler | undefined,
  label: string,
  work: () => T,
  detail?: string,
): T {
  return profile ? profile.timeSync(label, work, detail) : work();
}

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
  return isSourceFileExtension(ext);
}

/**
 * Try resolving a wiki link target as a source code reference.
 * Returns null if the reference is valid, or an error message string.
 */
export async function sourceRefError(
  target: string,
  projectRoot: string,
  sourceOptions: ResolveSourceSymbolOptions = {},
): Promise<string | null> {
  if (!isSourcePath(target)) {
    // Check if it looks like a file path with an unsupported extension
    const hashIdx = target.indexOf('#');
    const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
    const ext = extname(filePart);
    if (ext && hashIdx !== -1) {
      const supported = SOURCE_FILE_EXTENSIONS.join(', ');
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
      sourceOptions,
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

export async function checkMd(
  latticeDir: string,
  projectRoot = dirname(latticeDir),
  context?: CheckRunContext,
): Promise<CheckResult> {
  const run = context ?? new CheckRunContext(latticeDir, projectRoot);
  run.clearSourceSymbolCache();
  const files = await run.markdownFiles();
  const { sectionIds, fileIndex, slugIndex } = await run.sectionIndex();

  const errors: CheckError[] = [];
  const external = await run.externalResolver();
  for (const error of external.snapshot.errors) {
    errors.push({
      file: relative(process.cwd(), error.file),
      line: 1,
      target: '',
      message: error.message,
    });
  }

  for (const file of files) {
    const refs = await run.refs(file);
    const relPath = relative(process.cwd(), file);

    for (const ref of refs) {
      try {
        if (external.parse(ref.target)) {
          await run.resolveExternal(ref.target);
          continue;
        }
      } catch (error) {
        errors.push({
          file: relPath,
          line: ref.line,
          target: ref.target,
          message: `broken external link [[${ref.target}]] — ${(error as Error).message}`,
        });
        continue;
      }
      const unknownExternal = external.unknownTargetMessage(ref.target);
      if (unknownExternal) {
        errors.push({
          file: relPath,
          line: ref.line,
          target: ref.target,
          message: unknownExternal,
        });
        continue;
      }
      const { resolved, ambiguous, suggested } = resolveRef(
        ref.target,
        sectionIds,
        fileIndex,
        slugIndex,
      );
      if (ambiguous) {
        errors.push({
          file: relPath,
          line: ref.line,
          target: ref.target,
          message: ambiguousRefMessage(ref.target, ambiguous, suggested),
        });
      } else if (!sectionIds.has(resolved.toLowerCase())) {
        // Try resolving as a source code reference (e.g. [[src/foo.ts#bar]])
        const sourceErr = await run.resolveSourceLink(ref.target, () =>
          sourceRefError(ref.target, projectRoot, run.sourceSymbolOptions()),
        );
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

// --- Relative link validation ---

export async function checkLinks(
  latticeDir: string,
  context?: CheckRunContext,
): Promise<CheckError[]> {
  const run = context ?? new CheckRunContext(latticeDir, dirname(latticeDir));
  const files = await run.markdownFiles();
  const errors: CheckError[] = [];

  for (const file of files) {
    const links = await run.links(file);
    const relPath = toPosix(relative(process.cwd(), file));

    for (const diagnostic of await run.diagnostics(file)) {
      if (
        diagnostic.rule !== 'markdown-reference-definition' &&
        diagnostic.rule !== 'markdown-path-separator'
      ) {
        continue;
      }
      errors.push({
        file: relPath,
        line: diagnostic.line,
        target: diagnostic.target,
        message: diagnostic.message,
      });
    }

    for (const link of links) {
      if ('identifier' in link) continue;

      const target = parseLocalMarkdownTarget(link.url);
      if (target === null) continue;
      if (target.kind === 'invalid-backslash') continue;

      const abs = target.path ? resolve(dirname(file), target.path) : file;
      if (!existsSync(abs)) {
        const kind = link.kind === 'image' ? 'image' : 'link';
        const shown = toPosix(relative(process.cwd(), abs));
        errors.push({
          file: relPath,
          line: link.line,
          target: link.url,
          message: `broken ${kind} (${link.url}) — file "${shown}" not found`,
        });
        continue;
      }

      if (
        target.fragment &&
        extname(abs).toLowerCase() === '.md' &&
        link.kind !== 'image'
      ) {
        const headings = await run.headings(abs);
        if (!headings.has(target.fragment)) {
          const shown = toPosix(relative(process.cwd(), abs));
          errors.push({
            file: relPath,
            line: link.line,
            target: link.url,
            message: `broken link (${link.url}) — heading "#${target.fragment}" not found in "${shown}"`,
          });
        }
      }
    }
  }

  return errors;
}

export async function checkCodeRefs(
  latticeDir: string,
  projectRoot = dirname(latticeDir),
  context?: CheckRunContext,
): Promise<CheckResult> {
  const run = context ?? new CheckRunContext(latticeDir, projectRoot);
  const [{ sectionIds, fileIndex, slugIndex }, scan, external] =
    await Promise.all([
      run.sectionIndex(),
      run.codeRefs(),
      run.externalResolver(),
    ]);
  const errors: CheckError[] = [];
  for (const error of external.snapshot.errors) {
    errors.push({
      file: relative(process.cwd(), error.file),
      line: 1,
      target: '',
      message: error.message,
    });
  }

  const mentionedSections = new Set<string>();
  for (const ref of scan.refs) {
    try {
      const externalTarget = profileTimeSync(
        run.profile,
        'classify code-reference target',
        () => external.parse(ref.target),
        ref.target,
      );
      if (externalTarget) {
        await run.resolveExternal(ref.target);
        continue;
      }
    } catch (error) {
      errors.push({
        file: relative(process.cwd(), join(projectRoot, ref.file)),
        line: ref.line,
        target: ref.target,
        message: `@lat: [[${ref.target}]] — ${(error as Error).message}`,
      });
      continue;
    }
    const unknownExternal = profileTimeSync(
      run.profile,
      'check unknown external handle',
      () => external.unknownTargetMessage(ref.target),
      ref.target,
    );
    if (unknownExternal) {
      errors.push({
        file: relative(process.cwd(), join(projectRoot, ref.file)),
        line: ref.line,
        target: ref.target,
        message: `@lat: [[${ref.target}]] — ${unknownExternal}`,
      });
      continue;
    }
    const { resolved, ambiguous, suggested } = profileTimeSync(
      run.profile,
      'resolve internal code reference',
      () => resolveRef(ref.target, sectionIds, fileIndex, slugIndex),
      ref.target,
    );
    mentionedSections.add(resolved.toLowerCase());
    const displayPath = relative(process.cwd(), join(projectRoot, ref.file));
    if (ambiguous) {
      errors.push({
        file: displayPath,
        line: ref.line,
        target: ref.target,
        message: ambiguousRefMessage(ref.target, ambiguous, suggested),
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

  const files = await run.markdownFiles();
  for (const file of files) {
    const fm = await run.frontmatter(file);
    if (!fm.requireCodeMention) continue;

    const fileSections = flattenSections(await run.sections(file));
    const leafSections = fileSections.filter(
      (section) => section.children.length === 0,
    );
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

export async function checkIndex(
  latticeDir: string,
  context?: CheckRunContext,
): Promise<IndexError[]> {
  const run = context ?? new CheckRunContext(latticeDir, dirname(latticeDir));
  const errors: IndexError[] = [];
  const allPaths = await run.entries();

  // Flag non-.md files. The machine-local external override is the one
  // intentional non-Markdown configuration file in the vault.
  for (const p of allPaths) {
    const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    if (!name.endsWith('.md') && p !== 'config.local.yaml') {
      const relDir = basename(latticeDir) + '/';
      errors.push({
        dir: relDir,
        message: `"${p}" is not a .md file — only markdown files belong in the checked directory`,
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
      content = await run.content(indexFullPath);
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

export async function checkSections(
  latticeDir: string,
  projectRoot = dirname(latticeDir),
  context?: CheckRunContext,
): Promise<CheckError[]> {
  const run = context ?? new CheckRunContext(latticeDir, projectRoot);
  const files = await run.markdownFiles();
  const errors: CheckError[] = [];

  for (const file of files) {
    const relPath = relative(process.cwd(), file);
    for (const diagnostic of await run.diagnostics(file)) {
      if (diagnostic.rule !== 'section-leading-paragraph') continue;
      errors.push({
        file: relPath,
        line: diagnostic.line,
        target: diagnostic.target,
        message: diagnostic.message,
      });
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

export type CheckCommandOptions = {
  profile?: boolean;
};

export async function checkAllCommand(
  ctx: CmdContext,
  options: CheckCommandOptions = {},
): Promise<CmdResult> {
  const startTime = performance.now();
  const profile = options.profile ? new TimingProfiler() : undefined;
  const run = new CheckRunContext(ctx.latDir, ctx.projectRoot, profile);
  const [md, linkErrors, code, indexErrors, sectionErrors] = await Promise.all([
    profileTime(profile, 'check Markdown wiki links', () =>
      checkMd(ctx.latDir, ctx.projectRoot, run),
    ),
    profileTime(profile, 'check relative Markdown links', () =>
      checkLinks(ctx.latDir, run),
    ),
    profileTime(profile, 'check @lat code references', () =>
      checkCodeRefs(ctx.latDir, ctx.projectRoot, run),
    ),
    profileTime(profile, 'check directory indexes', () =>
      checkIndex(ctx.latDir, run),
    ),
    profileTime(profile, 'check section structure', () =>
      checkSections(ctx.latDir, ctx.projectRoot, run),
    ),
  ]);
  const elapsed = performance.now() - startTime;

  const allErrors = [
    ...new Map(
      [...md.errors, ...linkErrors, ...code.errors].map((error) => [
        `${error.file}\0${error.line}\0${error.target}\0${error.message}`,
        error,
      ]),
    ).values(),
  ];
  const allFiles: FileStats = { ...md.files };
  for (const [ext, n] of Object.entries(code.files)) {
    allFiles[ext] = (allFiles[ext] || 0) + n;
  }

  const s = ctx.styler;
  const elapsedStr =
    elapsed < 1000
      ? `${Math.round(elapsed)}ms`
      : `${(elapsed / 1000).toFixed(1)}s`;
  const lines: string[] = [
    formatFileStats(allFiles, s) + s.dim(` in ${elapsedStr}`),
  ];
  if (profile) lines.push('', ...profile.format(elapsed));

  // Init version warning first — user should fix setup before addressing errors
  if (!ctx.headless) {
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
  const { errors, files } = await checkMd(ctx.latDir, ctx.projectRoot);
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

export async function checkLinksCommand(ctx: CmdContext): Promise<CmdResult> {
  const errors = await checkLinks(ctx.latDir);
  const s = ctx.styler;
  const lines: string[] = [];

  lines.push(...formatCheckErrors(errors, s));

  if (errors.length > 0) {
    lines.push(formatErrorCount(errors.length, s));
    return { output: lines.join('\n'), isError: true };
  }

  lines.push(s.green('links: All relative links resolve'));
  return { output: lines.join('\n') };
}

export async function checkCodeRefsCommand(
  ctx: CmdContext,
): Promise<CmdResult> {
  const { errors, files } = await checkCodeRefs(ctx.latDir, ctx.projectRoot);
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
  const errors = await checkSections(ctx.latDir, ctx.projectRoot);
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
