import { lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { isSourceFilePath, SOURCE_FILE_EXTENSIONS } from './source-formats.js';
import { toPosix } from './path.js';
import { ALWAYS_IGNORED_DIRECTORIES, walkEntries } from './walk.js';
import type { Profiler } from './profiler.js';

/** Glob patterns used to exclude directories/files from code-ref scanning.
 *  Shared between rg args and the TS fallback's walkFiles filter. */
const EXCLUDE_DIRS = ['lat.md', '.claude', ...ALWAYS_IGNORED_DIRECTORIES];
const EXCLUDE_GLOBS = ['*.md', '.*', '**/.*'];
const RG_IGNORE_ARGS = ['--no-require-git', '--ignore-file-case-insensitive'];

/** Walk supported source files for code-ref scanning. Uses walkEntries for
 *  .gitignore support, then additionally skips lat.md/, .claude/, and
 *  sub-projects. */
export async function walkFiles(dir: string): Promise<string[]> {
  const entries = (await walkEntries(dir)).map(toPosix);

  // Collect directories that contain their own lat.md/ (sub-projects)
  const subProjects = new Set<string>();
  for (const e of entries) {
    const i = e.indexOf('/lat.md/');
    if (i !== -1) subProjects.add(e.slice(0, i + 1));
  }

  return entries
    .filter(
      (e) =>
        isSourceFilePath(e) &&
        !e.startsWith('lat.md/') &&
        !e.startsWith('.claude/') &&
        ![...subProjects].some((prefix) => e.startsWith(prefix)),
    )
    .map((e) => join(dir, e));
}

/** Build a RegExp from a verbose template — whitespace is insignificant. */
function re(flags: string) {
  return (strings: TemplateStringsArray) =>
    new RegExp(strings.raw[0].replace(/\s+/g, ''), flags);
}

// Line comment (// or #), then @lat: marker, then [[target]]
export const LAT_REF_RE = re('gv')`
  (?: // | # )
  \s* @lat: \s*
  \[\[
    ( [^\]]+ )
  \]\]
`;

export type CodeRef = {
  target: string;
  file: string;
  line: number;
};

export type ScanResult = {
  refs: CodeRef[];
};

export type CodeReferenceDiscovery = {
  scan: () => Promise<ScanResult>;
  listSourceFiles: () => Promise<string[]>;
};

function profileScan<T>(
  profile: Pick<Profiler, 'time'> | undefined,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  return profile ? profile.time(label, work) : work();
}

/**
 * Run an external command and return stdout, or null if the command is not found
 * or fails.
 */
function tryExec(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 50 * 1024 * 1024 }, (err, out) => {
      if (err) {
        // Exit code 1 with no stderr typically means "no matches" for rg.
        const exitCode = (
          err as NodeJS.ErrnoException & { code?: string | number }
        ).code;
        if (exitCode === 'ENOENT') {
          resolve(null); // command not found
          return;
        }
        // rg exit 1 = no matches (not an error)
        if (
          'status' in err &&
          (err as { status?: number }).status === 1 &&
          out === ''
        ) {
          resolve('');
          return;
        }
        resolve(null);
        return;
      }
      resolve(out);
    });
  });
}

/**
 * Detect sub-projects (directories containing their own lat.md/) using
 * rg --files. Finds files inside nested lat.md/ dirs and extracts the parent
 * directory paths. Returns paths relative to projectRoot.
 */
async function findSubProjects(projectRoot: string): Promise<string[]> {
  // List files inside any lat.md/ dir, then extract unique parent paths.
  // The root lat.md/ is excluded by EXCLUDE_DIRS in the caller, so we only
  // need to find nested ones here — search for files under */lat.md/.
  const out = await tryExec(
    'rg',
    ['--files', ...RG_IGNORE_ARGS, '--glob', '**/lat.md/**', '.'],
    projectRoot,
  );
  if (!out) return [];

  const subProjects = new Set<string>();
  for (const rawLine of out.split('\n')) {
    if (!rawLine) continue;
    // rg emits native separators on Windows; normalize before matching '/lat.md/'.
    const line = toPosix(rawLine);
    const clean = line.startsWith('./') ? line.slice(2) : line;
    // "tests/cases/foo/lat.md/specs.md" → "tests/cases/foo"
    // Skip root lat.md/ (no parent prefix — starts with "lat.md/")
    const idx = clean.indexOf('/lat.md/');
    if (idx !== -1) subProjects.add(clean.slice(0, idx));
  }
  return [...subProjects];
}

function nestedLatProjects(paths: readonly string[]): string[] {
  const projects = new Set<string>();
  for (const path of paths) {
    const index = path.indexOf('/lat.md/');
    if (index !== -1) projects.add(path.slice(0, index));
  }
  return [...projects];
}

function hasDotDirectory(path: string): boolean {
  const parts = path.split('/');
  return parts.slice(0, -1).some((part) => part.startsWith('.'));
}

/** List readable regular source files tracked by the enclosing Git repository. */
async function findGitTrackedSourceFiles(
  projectRoot: string,
): Promise<string[] | null> {
  const out = await tryExec(
    'git',
    ['ls-files', '--stage', '-z', '--', '.'],
    projectRoot,
  );
  if (out === null) return null;

  const entries = out
    .split('\0')
    .filter(Boolean)
    .flatMap((entry) => {
      const tab = entry.indexOf('\t');
      if (tab === -1) return [];
      const mode = entry.slice(0, entry.indexOf(' '));
      if (mode !== '100644' && mode !== '100755') return [];
      return [toPosix(entry.slice(tab + 1))];
    });
  const subProjects = nestedLatProjects(entries);
  const candidates = entries.filter(
    (path) =>
      isSourceFilePath(path) &&
      !hasDotDirectory(path) &&
      !path.startsWith('lat.md/') &&
      !subProjects.some(
        (project) => path === project || path.startsWith(`${project}/`),
      ),
  );

  return candidates
    .flatMap((path) => {
      const absolute = join(projectRoot, path);
      try {
        return lstatSync(absolute).isFile() ? [absolute] : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    })
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/** Build rg glob exclusion args. */
function rgExcludeArgs(subProjects: string[]): string[] {
  const args: string[] = [];
  for (const dir of EXCLUDE_DIRS) args.push('--glob', `!${dir}/`);
  for (const glob of EXCLUDE_GLOBS) args.push('--glob', `!${glob}`);
  for (const sp of subProjects) args.push('--glob', `!${sp}/`);
  return args;
}

/** Build an rg file type from the shared supported-source registry. */
function rgSourceIncludeArgs(): string[] {
  return [
    ...SOURCE_FILE_EXTENSIONS.flatMap((extension) => [
      '--type-add',
      `latsource:*${extension}`,
    ]),
    '--type',
    'latsource',
  ];
}

async function discoverRipgrepExcludes(
  projectRoot: string,
  profile?: Pick<Profiler, 'time'>,
): Promise<string[]> {
  const subProjects = await profileScan(
    profile,
    'find nested lat.md projects with ripgrep',
    () => findSubProjects(projectRoot),
  );
  return rgExcludeArgs(subProjects);
}

function ripgrepPathBatches(paths: string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let length = 0;
  for (const path of paths) {
    if (batch.length > 0 && length + path.length + 1 > 16_000) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(path);
    length += path.length + 1;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function runRipgrepBatches(
  projectRoot: string,
  args: string[],
  paths: string[],
): Promise<string[] | null> {
  const batches = ripgrepPathBatches(paths);
  if (batches.length === 0) return [];
  const results = new Array<string | null>(batches.length);
  let nextIndex = 0;
  const workerCount = Math.min(availableParallelism(), batches.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= batches.length) return;
        results[index] = await tryExec(
          'rg',
          [...args, '--', ...batches[index]],
          projectRoot,
        );
      }
    }),
  );

  return results.some((result) => result === null)
    ? null
    : (results as string[]);
}

/** Search supported source files for code references with ripgrep. */
async function tryRipgrepCodeRefs(
  projectRoot: string,
  excludes: string[],
  profile?: Pick<Profiler, 'time'>,
  files?: string[],
): Promise<CodeRef[] | null> {
  const searchArgs = [
    '--no-heading',
    '--line-number',
    '--with-filename',
    ...RG_IGNORE_ARGS,
    ...rgSourceIncludeArgs(),
    ...excludes,
    '@lat:.*\\[\\[',
  ];
  const outputs = await profileScan(
    profile,
    'scan @lat references with ripgrep',
    () =>
      files
        ? runRipgrepBatches(
            projectRoot,
            searchArgs,
            files.map((file) => toPosix(relative(projectRoot, file))),
          )
        : tryExec('rg', [...searchArgs, '.'], projectRoot).then((output) =>
            output === null ? null : [output],
          ),
  );
  if (outputs === null) return null;

  const refs = outputs.flatMap(
    (output) => parseGrepOutput(output, projectRoot).refs,
  );
  refs.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line);
  return refs;
}

/** Discover the supported source-file scope with ripgrep. */
async function tryRipgrepSourceFiles(
  projectRoot: string,
  excludes: string[],
  profile?: Pick<Profiler, 'time'>,
): Promise<string[] | null> {
  const filesOut = await profileScan(
    profile,
    'list source files with ripgrep',
    () =>
      tryExec(
        'rg',
        [
          '--files',
          ...RG_IGNORE_ARGS,
          ...rgSourceIncludeArgs(),
          ...excludes,
          '.',
        ],
        projectRoot,
      ),
  );
  if (filesOut === null) return null;

  const files = (filesOut || '')
    .split('\n')
    .filter(Boolean)
    .map((f) => {
      const clean = toPosix(f).replace(/^\.\//, '');
      return join(projectRoot, clean);
    })
    .sort((a, b) => a.localeCompare(b, 'en'));
  return files;
}

/**
 * Parse rg output lines (file:line:content) into CodeRef entries.
 */
function parseGrepOutput(
  output: string,
  projectRoot: string,
): { refs: CodeRef[] } {
  const refs: CodeRef[] = [];

  if (!output.trim()) return { refs };

  for (const line of output.split('\n')) {
    if (!line) continue;
    // Format: ./path/to/file:linenum:content
    const firstColon = line.indexOf(':');
    if (firstColon === -1) continue;
    const secondColon = line.indexOf(':', firstColon + 1);
    if (secondColon === -1) continue;

    // rg emits native separators (`\` on Windows); normalize to POSIX so the
    // stored path matches wiki-link and TS-fallback conventions. This also
    // turns a Windows `.\` prefix into `./` for the strip below.
    let filePath = toPosix(line.slice(0, firstColon));
    const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10);
    const content = line.slice(secondColon + 1);

    if (isNaN(lineNum)) continue;

    // Strip leading ./ from path
    if (filePath.startsWith('./')) filePath = filePath.slice(2);

    // Extract targets using the same regex as the TS fallback
    LAT_REF_RE.lastIndex = 0;
    let match;
    while ((match = LAT_REF_RE.exec(content)) !== null) {
      refs.push({ target: match[1], file: filePath, line: lineNum });
    }
  }

  return { refs };
}

type TsFileScan = { refs: CodeRef[]; error?: string };

async function scanFileWithTs(
  file: string,
  projectRoot: string,
): Promise<TsFileScan> {
  let content: string;
  try {
    content = await readFile(file, 'utf-8');
  } catch (err) {
    return {
      refs: [],
      error: `Error: failed to read ${file}: ${(err as Error).message}\n`,
    };
  }

  const refs: CodeRef[] = [];
  const relativePath = toPosix(relative(projectRoot, file));
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    LAT_REF_RE.lastIndex = 0;
    let match;
    while ((match = LAT_REF_RE.exec(lines[i])) !== null) {
      refs.push({
        target: match[1],
        file: relativePath,
        line: i + 1,
      });
    }
  }
  return { refs };
}

/** TypeScript fallback: scan supported source files through a bounded pool. */
async function scanWithTs(
  files: string[],
  projectRoot: string,
): Promise<CodeRef[]> {
  const results = new Array<TsFileScan>(files.length);
  let nextIndex = 0;
  const workerCount = Math.min(availableParallelism(), files.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= files.length) return;
        results[index] = await scanFileWithTs(files[index], projectRoot);
      }
    }),
  );

  const refs: CodeRef[] = [];
  for (const result of results) {
    if (result.error) process.stderr.write(result.error);
    refs.push(...result.refs);
  }

  return refs;
}

/** Check whether ripgrep (`rg`) is available on PATH. */
export async function hasRipgrep(): Promise<boolean> {
  const result = await tryExec('rg', ['--version'], '.');
  return result !== null;
}

/**
 * Create a lazy project-scoped discovery API. Code-reference scanning and
 * source-file inventory are separate operations, but share ripgrep exclusion
 * discovery and coalesce fallback file walking when both are requested.
 */
export function createCodeReferenceDiscovery(
  projectRoot: string,
  profile?: Pick<Profiler, 'time'>,
): CodeReferenceDiscovery {
  let excludesPromise: Promise<string[]> | undefined;
  let trackedFilesPromise: Promise<string[] | null> | undefined;
  let sourceFilesPromise: Promise<string[]> | undefined;
  let scanPromise: Promise<ScanResult> | undefined;

  const ripgrepExcludes = () =>
    (excludesPromise ??= discoverRipgrepExcludes(projectRoot, profile));

  const trackedFiles = () =>
    (trackedFilesPromise ??= profileScan(
      profile,
      'list tracked source files with git',
      () => findGitTrackedSourceFiles(projectRoot),
    ));

  const listSourceFiles = () =>
    (sourceFilesPromise ??= (async () => {
      const tracked = await trackedFiles();
      if (tracked !== null) return tracked;

      if (process.env._LAT_DISABLE_RG !== '1') {
        const files = await tryRipgrepSourceFiles(
          projectRoot,
          await ripgrepExcludes(),
          profile,
        );
        if (files !== null) return files;
      }

      return profileScan(profile, 'walk project source files', () =>
        walkFiles(projectRoot),
      );
    })());

  const scan = () =>
    (scanPromise ??= (async () => {
      const tracked = await trackedFiles();
      if (process.env._LAT_DISABLE_RG !== '1') {
        const refs = await tryRipgrepCodeRefs(
          projectRoot,
          tracked === null ? await ripgrepExcludes() : [],
          profile,
          tracked ?? undefined,
        );
        if (refs !== null) return { refs };
      }

      const refs = await profileScan(
        profile,
        'scan project files with TypeScript fallback',
        async () => scanWithTs(await listSourceFiles(), projectRoot),
      );
      return { refs };
    })());

  return { scan, listSourceFiles };
}

export async function scanCodeRefs(
  projectRoot: string,
  profile?: Pick<Profiler, 'time'>,
): Promise<ScanResult> {
  return createCodeReferenceDiscovery(projectRoot, profile).scan();
}

/** Discover the source files that may contain code references. */
export async function discoverSourceFiles(
  projectRoot: string,
  profile?: Pick<Profiler, 'time'>,
): Promise<string[]> {
  return createCodeReferenceDiscovery(projectRoot, profile).listSourceFiles();
}
