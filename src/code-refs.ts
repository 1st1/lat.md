import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join, posix, relative } from 'node:path';
import { isSourceFilePath, SOURCE_FILE_EXTENSIONS } from './source-formats.js';
import { toPosix } from './path.js';
import { walkEntries } from './walk.js';
import type { Profiler } from './profiler.js';

/** Glob patterns used to exclude directories/files from code-ref scanning.
 *  Shared between rg args and the TS fallback's walkFiles filter. */
const EXCLUDE_DIRS = ['lat.md', '.claude'];
const EXCLUDE_GLOBS = ['*.md', '.*', '**/.*'];
const RG_IGNORE_ARGS = ['--no-require-git', '--ignore-file-case-insensitive'];

/** Walk supported source files for code-ref scanning. Uses walkEntries for
 *  .gitignore support, then additionally skips lat.md/, .claude/, generated
 *  output, and sub-projects. */
export async function walkFiles(dir: string): Promise<string[]> {
  const entries = (await walkEntries(dir)).map(toPosix);
  const generatedOutputs = new Set(
    entries
      .filter((entry) => entry.endsWith('/.lat-ui-build'))
      .map((entry) => `${posix.dirname(entry)}/`),
  );

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
        ![...generatedOutputs].some((prefix) => e.startsWith(prefix)) &&
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

/** Find static UI exports so generated JSON and bundles never become code refs. */
async function findGeneratedOutputs(projectRoot: string): Promise<string[]> {
  const out = await tryExec(
    'rg',
    [
      '--files',
      ...RG_IGNORE_ARGS,
      '--hidden',
      '--glob',
      '**/.lat-ui-build',
      '.',
    ],
    projectRoot,
  );
  if (!out) return [];

  return [
    ...new Set(
      out
        .split('\n')
        .filter(Boolean)
        .map((line) => toPosix(line).replace(/^\.\//, ''))
        .filter((line) => line.endsWith('/.lat-ui-build'))
        .map((line) => posix.dirname(line)),
    ),
  ];
}

/** Build rg glob exclusion args. */
function rgExcludeArgs(
  subProjects: string[],
  generatedOutputs: string[],
): string[] {
  const args: string[] = [];
  for (const dir of EXCLUDE_DIRS) args.push('--glob', `!${dir}/`);
  for (const glob of EXCLUDE_GLOBS) args.push('--glob', `!${glob}`);
  for (const sp of subProjects) args.push('--glob', `!${sp}/`);
  for (const output of generatedOutputs) args.push('--glob', `!${output}/`);
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
  const [subProjects, generatedOutputs] = await Promise.all([
    profileScan(profile, 'find nested lat.md projects with ripgrep', () =>
      findSubProjects(projectRoot),
    ),
    profileScan(profile, 'find generated UI outputs with ripgrep', () =>
      findGeneratedOutputs(projectRoot),
    ),
  ]);
  return rgExcludeArgs(subProjects, generatedOutputs);
}

/** Search supported source files for code references with ripgrep. */
async function tryRipgrepCodeRefs(
  projectRoot: string,
  excludes: string[],
  profile?: Pick<Profiler, 'time'>,
): Promise<CodeRef[] | null> {
  const searchArgs = [
    '--no-heading',
    '--line-number',
    '--with-filename',
    ...RG_IGNORE_ARGS,
    ...rgSourceIncludeArgs(),
    ...excludes,
    '@lat:.*\\[\\[',
    '.',
  ];
  const out = await profileScan(
    profile,
    'scan @lat references with ripgrep',
    () => tryExec('rg', searchArgs, projectRoot),
  );
  if (out === null) return null;

  const { refs } = parseGrepOutput(out, projectRoot);
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
  let sourceFilesPromise: Promise<string[]> | undefined;
  let scanPromise: Promise<ScanResult> | undefined;

  const ripgrepExcludes = () =>
    (excludesPromise ??= discoverRipgrepExcludes(projectRoot, profile));

  const listSourceFiles = () =>
    (sourceFilesPromise ??= (async () => {
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
      if (process.env._LAT_DISABLE_RG !== '1') {
        const refs = await tryRipgrepCodeRefs(
          projectRoot,
          await ripgrepExcludes(),
          profile,
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
