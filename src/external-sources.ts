import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml, parseDocument } from 'yaml';
import { z } from 'zod';
import {
  DOCUMENT_FILE_EXTENSIONS,
  isDocumentPath,
} from './document-formats.js';
import {
  ExternalDocumentParserRuntime,
  analyzeExternalDocumentCached,
  findExternalDocumentSection,
  type ExternalDocumentAnalysis,
  type ExternalDocumentFileAnalysis,
} from './external-documents.js';
import {
  SourceParserRuntime,
  analyzeSourceSymbols,
  type SourceSymbol,
} from './source-parser.js';
import { SOURCE_FILE_EXTENSIONS } from './source-formats.js';
import type { ParserImportObserver } from './parser-import.js';

const execFileAsync = promisify(execFile);
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]*$/;
const COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_BYTES = 5 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/** Version of the external cache metadata and on-disk provider layouts. */
export const EXTERNAL_SOURCES_SCHEMA_VER = 1;

/** File types external sources can parse and resolve. */
const EXTERNAL_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...DOCUMENT_FILE_EXTENSIONS,
  ...SOURCE_FILE_EXTENSIONS,
]);

export type ExternalStrategy = 'fetch' | 'checkout';
export type EffectiveExternalStrategy = ExternalStrategy | 'local';

export type CanonicalExternalSource = {
  handle: string;
  repo: string;
  source: string;
  commit: string;
  prefix: string;
  defaultFileExtension?: string;
  strategy: ExternalStrategy;
  fetchUrl?: string;
};

export type LocalExternalOverride = {
  localPath?: string;
  commit?: string;
};

export type EffectiveExternalSource = CanonicalExternalSource & {
  canonicalCommit: string;
  effectiveStrategy: EffectiveExternalStrategy;
  localPath?: string;
  localError?: string;
};

export type ExternalSourcesSnapshot = {
  canonicalPath: string;
  localPath: string;
  sources: Map<string, EffectiveExternalSource>;
  errors: ExternalConfigError[];
  validCanonical: boolean;
};

export type ExternalConfigError = { file: string; message: string };

export type ExternalTarget = {
  target: string;
  handle: string;
  authoredPath: string;
  resolvedPath: string;
  repositoryPath: string;
  fragment: string;
  identity: string;
};

type ResolvedExternalContentBase = {
  target: ExternalTarget;
  source: EffectiveExternalSource;
  provider: EffectiveExternalStrategy;
  content: string;
  fullContent: string;
  startLine: number;
  endLine: number;
};

export type ResolvedExternalContent = ResolvedExternalContentBase &
  (
    | { kind: 'document'; document: ExternalDocumentAnalysis }
    | { kind: 'source'; signature?: string }
  );

export type ExternalCacheMetadata = {
  ver: number;
  source: string;
  commit: string;
  strategy: EffectiveExternalStrategy;
};

const canonicalSourceSchema = z
  .strictObject({
    repo: z.string(),
    commit: z.string(),
    prefix: z.string().optional(),
    'default-file-extension': z.string().optional(),
    strategy: z.enum(['fetch', 'checkout']),
    'fetch-url': z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.strategy === 'checkout' && value['fetch-url']) {
      ctx.addIssue({
        code: 'custom',
        message: 'fetch-url is forbidden with strategy: checkout',
      });
    }
  });

const localSourceSchema = z.strictObject({
  'local-path': z.string().min(1).optional(),
  commit: z.string().optional(),
});

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function frontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1] ?? null;
}

function portablePath(
  value: string,
  label: string,
  allowEmpty = false,
): string {
  if (value === '' && allowEmpty) return '';
  if (
    !value ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith('//')
  ) {
    throw new Error(`${label} must be a relative POSIX path`);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} cannot contain empty, ".", or ".." segments`);
  }
  return parts.join('/');
}

export function normalizeExternalDefaultFileExtension(value: string): string {
  if (value.startsWith('.')) {
    throw new Error('default-file-extension must not start with "."');
  }
  if (!/^[a-z0-9]+$/i.test(value)) {
    throw new Error(
      'default-file-extension must contain only letters and numbers',
    );
  }
  const normalized = value.toLowerCase();
  const extension = `.${normalized}`;
  if (!EXTERNAL_FILE_EXTENSIONS.has(extension)) {
    const supported = [...EXTERNAL_FILE_EXTENSIONS]
      .map((item) => item.slice(1))
      .sort()
      .join(', ');
    throw new Error(
      `unsupported default file extension "${normalized}"; supported extensions: ${supported}`,
    );
  }
  return normalized;
}

export function normalizeExternalRepoUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('repo must be an absolute HTTPS URL');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'repo must be credential-free HTTPS without query or fragment',
    );
  }
  if (!url.pathname || url.pathname === '/') {
    throw new Error('repo must include a repository path');
  }
  url.hostname = url.hostname.toLowerCase();
  url.protocol = 'https:';
  if (url.port === '443') url.port = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (
    (url.hostname === 'github.com' || url.hostname === 'gitlab.com') &&
    url.pathname.endsWith('.git')
  ) {
    url.pathname = url.pathname.slice(0, -4);
  }
  return url.toString().replace(/\/$/, '');
}

function validateFetchUrl(value: string): string {
  const allowed = new Set(['{commit}', '{path}']);
  const found = new Set<string>();
  const coveredBraces = new Set<number>();
  const unsupported: string[] = [];
  const malformed: string[] = [];
  for (const match of value.matchAll(/\{[^{}]*\}/g)) {
    const placeholder = match[0];
    const start = match.index ?? 0;
    coveredBraces.add(start);
    coveredBraces.add(start + placeholder.length - 1);
    if (allowed.has(placeholder)) {
      found.add(placeholder);
    } else if (/^\{[A-Za-z][A-Za-z0-9_-]*\}$/.test(placeholder)) {
      unsupported.push(placeholder);
    } else {
      malformed.push(placeholder);
    }
  }
  if (unsupported.length > 0) {
    throw new Error(
      `fetch-url contains unsupported placeholder ${JSON.stringify(unsupported[0])}; allowed placeholders are "{commit}" and "{path}"`,
    );
  }
  if (malformed.length > 0) {
    throw new Error(
      `fetch-url contains malformed placeholder ${JSON.stringify(malformed[0])}; placeholders must be exactly "{commit}" or "{path}"`,
    );
  }
  let unmatchedBrace = -1;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if ((character === '{' || character === '}') && !coveredBraces.has(index)) {
      unmatchedBrace = index;
      break;
    }
  }
  if (unmatchedBrace !== -1) {
    throw new Error(
      `fetch-url contains unmatched ${JSON.stringify(value[unmatchedBrace])} at character ${unmatchedBrace + 1}; placeholders must be exactly "{commit}" or "{path}"`,
    );
  }
  if (!found.has('{commit}')) {
    throw new Error('fetch-url must contain {commit}');
  }
  if (!found.has('{path}')) {
    throw new Error('fetch-url must contain {path}');
  }
  const checked = value
    .replaceAll('{commit}', '0123456789012345678901234567890123456789')
    .replaceAll('{path}', 'docs/file.md');
  let url: URL;
  try {
    url = new URL(checked);
  } catch {
    throw new Error('fetch-url must be an absolute HTTPS URL template');
  }
  validateHttpsUrl(url, 'fetch-url');
  return value;
}

export function inferExternalFetchUrl(repo: string): string | null {
  const url = new URL(repo);
  const parts = url.pathname.replace(/^\//, '').split('/');
  if (url.hostname === 'github.com' && parts.length === 2) {
    return `https://raw.githubusercontent.com/${parts.join('/')}/{commit}/{path}`;
  }
  if (url.hostname === 'gitlab.com' && parts.length >= 2) {
    return `https://gitlab.com/${parts.join('/')}/-/raw/{commit}/{path}`;
  }
  return null;
}

function validateHttpsUrl(url: URL, label: string): void {
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      `${label} must be a credential-free HTTPS URL without a fragment`,
    );
  }
}

function sourceFromValue(
  handle: string,
  value: unknown,
): CanonicalExternalSource {
  if (!HANDLE_RE.test(handle)) {
    throw new Error(`invalid external source name "${handle}"`);
  }
  const parsed = canonicalSourceSchema.parse(value);
  const repo = normalizeExternalRepoUrl(parsed.repo);
  if (!COMMIT_RE.test(parsed.commit)) {
    throw new Error('commit must be a full lowercase Git SHA');
  }
  const prefix = parsed.prefix ? portablePath(parsed.prefix, 'prefix') : '';
  const defaultFileExtension = parsed['default-file-extension']
    ? normalizeExternalDefaultFileExtension(parsed['default-file-extension'])
    : undefined;
  let fetchUrl = parsed['fetch-url'];
  if (parsed.strategy === 'fetch') {
    const inferred = fetchUrl ?? inferExternalFetchUrl(repo);
    if (!inferred) {
      throw new Error(
        'fetch-url is required for fetch sources outside GitHub and GitLab',
      );
    }
    fetchUrl = validateFetchUrl(inferred);
  }
  return {
    handle,
    repo,
    source: parsed.strategy === 'fetch' ? fetchUrl! : parsed.repo,
    commit: parsed.commit,
    prefix,
    ...(defaultFileExtension ? { defaultFileExtension } : {}),
    strategy: parsed.strategy,
    ...(fetchUrl ? { fetchUrl } : {}),
  };
}

function expandLocalPath(value: string, projectRoot: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(projectRoot, value);
}

const gitEnvironment = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https',
  };
  delete env.GIT_CONFIG_PARAMETERS;
  delete env.GIT_CONFIG_COUNT;
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }
  return env;
};

async function git(
  args: string[],
  options: { cwd?: string; maxBuffer?: number; trim?: boolean } = {},
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: gitEnvironment(),
    maxBuffer: options.maxBuffer ?? MAX_BYTES + 1024 * 1024,
    timeout: 60_000,
  });
  return options.trim === false ? stdout : stdout.trim();
}

async function localCheckoutStatus(
  source: CanonicalExternalSource,
  local: LocalExternalOverride,
  projectRoot: string,
): Promise<{ path?: string; error?: string }> {
  if (!local.localPath) return {};
  const path = expandLocalPath(local.localPath, projectRoot);
  const expected = local.commit ?? source.commit;
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error('local path cannot be a symlink');
    }
    if (!statSync(path).isDirectory()) throw new Error('not a directory');
    const root = realpathSync(
      await git(['-C', path, 'rev-parse', '--show-toplevel']),
    );
    const head = await git(['-C', root, 'rev-parse', 'HEAD']);
    if (head !== expected) {
      throw new Error(`HEAD is ${head}, expected ${expected}`);
    }
    const remotes = (await git(['-C', root, 'remote']))
      .split('\n')
      .filter(Boolean);
    const discovered: Array<{ remote: string; url: string }> = [];
    let matches = false;
    for (const remote of remotes) {
      const candidates = (
        await git(['-C', root, 'remote', 'get-url', '--all', remote])
      )
        .split('\n')
        .filter(Boolean);
      for (const candidate of candidates) {
        discovered.push({ remote, url: candidate });
        try {
          if (normalizeExternalRepoUrl(candidate) === source.repo) {
            matches = true;
          }
        } catch {
          // Unsupported local remote; another URL may identify the repository.
        }
      }
    }
    if (!matches) {
      const found =
        discovered.length === 0
          ? 'found no Git remote URLs'
          : `found ${discovered
              .map(({ remote, url }) => `${remote}=${JSON.stringify(url)}`)
              .join(', ')}`;
      throw new Error(
        `no Git remote URL matches configured repo ${JSON.stringify(source.repo)}; ${found}`,
      );
    }
    return { path: root };
  } catch (error) {
    return {
      error: `external source "${source.handle}" local-path "${path}" is invalid: ${(error as Error).message}`,
    };
  }
}

export async function loadExternalSources(
  latDir: string,
  projectRoot = dirname(latDir),
  options: { ignoreLocal?: boolean } = {},
): Promise<ExternalSourcesSnapshot> {
  const canonicalPath = join(latDir, 'lat.md');
  const localPath = join(latDir, 'config.local.yaml');
  const errors: ExternalConfigError[] = [];
  const canonical = new Map<string, CanonicalExternalSource>();
  const overrides = new Map<string, LocalExternalOverride>();
  let validCanonical = true;

  try {
    const yaml = frontmatter(await readFile(canonicalPath, 'utf8'));
    const parsed = yaml ? parseYaml(yaml) : {};
    const raw =
      record(parsed) && record(parsed.lat)
        ? parsed.lat['external-sources']
        : undefined;
    if (raw !== undefined && !record(raw)) {
      throw new Error('lat.external-sources must be a mapping');
    }
    for (const [handle, value] of Object.entries(record(raw) ? raw : {})) {
      canonical.set(handle, sourceFromValue(handle, value));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      validCanonical = false;
      errors.push({ file: canonicalPath, message: (error as Error).message });
    }
  }

  if (!options.ignoreLocal && existsSync(localPath)) {
    try {
      const parsed = parseYaml(await readFile(localPath, 'utf8'));
      const raw = record(parsed) ? parsed['external-sources'] : undefined;
      if (raw !== undefined && !record(raw)) {
        throw new Error('external-sources must be a mapping');
      }
      for (const [handle, value] of Object.entries(record(raw) ? raw : {})) {
        if (!canonical.has(handle)) {
          throw new Error(
            `local override references unknown source "${handle}"`,
          );
        }
        const item = localSourceSchema.parse(value);
        if (item.commit && !COMMIT_RE.test(item.commit)) {
          throw new Error(`${handle}.commit must be a full lowercase Git SHA`);
        }
        overrides.set(handle, {
          ...(item['local-path'] ? { localPath: item['local-path'] } : {}),
          ...(item.commit ? { commit: item.commit } : {}),
        });
      }
    } catch (error) {
      errors.push({ file: localPath, message: (error as Error).message });
    }
  }

  const sources = new Map<string, EffectiveExternalSource>();
  for (const source of canonical.values()) {
    const local = overrides.get(source.handle) ?? {};
    const status = await localCheckoutStatus(source, local, projectRoot);
    const effectiveCommit = local.commit ?? source.commit;
    sources.set(source.handle, {
      ...source,
      source: status.path ? local.localPath! : source.source,
      canonicalCommit: source.commit,
      commit: effectiveCommit,
      effectiveStrategy: status.path ? 'local' : source.strategy,
      ...(status.path ? { localPath: status.path } : {}),
      ...(status.error ? { localError: status.error } : {}),
    });
    if (status.error) errors.push({ file: localPath, message: status.error });
  }
  return { canonicalPath, localPath, sources, errors, validCanonical };
}

export function parseExternalTarget(
  value: string,
  snapshot: Pick<ExternalSourcesSnapshot, 'sources'>,
): ExternalTarget | null {
  const target = value.replace(/^\[\[|\]\]$/g, '');
  const colon = target.indexOf(':');
  if (colon <= 0) return null;
  const handle = target.slice(0, colon);
  const source = snapshot.sources.get(handle);
  if (!source) return null;
  const rest = target.slice(colon + 1);
  const hash = rest.indexOf('#');
  const authoredPath = portablePath(
    hash === -1 ? rest : rest.slice(0, hash),
    'external path',
  );
  const fragment = hash === -1 ? '' : rest.slice(hash + 1);
  if (/^L\d+(?:-L?\d+)?$/i.test(fragment)) {
    throw new Error('external fragments cannot use line numbers');
  }
  const authoredExtension = extname(authoredPath);
  const resolvedPath =
    !authoredExtension && source.defaultFileExtension
      ? `${authoredPath}.${source.defaultFileExtension}`
      : authoredPath;
  const ext = extname(resolvedPath).toLowerCase();
  if (!EXTERNAL_FILE_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported external file extension "${ext || '(none)'}"`);
  }
  const defaultSuffix = source.defaultFileExtension
    ? `.${source.defaultFileExtension}`
    : '';
  const identityPath =
    defaultSuffix &&
    resolvedPath.length > defaultSuffix.length &&
    resolvedPath.endsWith(defaultSuffix)
      ? resolvedPath.slice(0, -defaultSuffix.length)
      : authoredPath;
  const repositoryPath = source.prefix
    ? `${source.prefix}/${resolvedPath}`
    : resolvedPath;
  return {
    target,
    handle,
    authoredPath,
    resolvedPath,
    repositoryPath,
    fragment,
    identity: `${handle}:${identityPath}${fragment ? `#${fragment}` : ''}`,
  };
}

function editDistance(left: string, right: string): number {
  const previous = [...Array(right.length + 1).keys()];
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function unknownExternalHandle(
  targetValue: string,
  snapshot: Pick<ExternalSourcesSnapshot, 'sources'>,
): string | null {
  const target = targetValue.replace(/^\[\[|\]\]$/g, '');
  const colon = target.indexOf(':');
  if (colon <= 0) return null;
  const handle = target.slice(0, colon);
  if (!HANDLE_RE.test(handle) || snapshot.sources.has(handle)) return null;
  const candidates = [...snapshot.sources.keys()]
    .map((candidate) => ({
      candidate,
      distance: editDistance(handle, candidate),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.candidate.localeCompare(right.candidate),
    );
  const suggestion = candidates[0];
  return suggestion &&
    suggestion.distance <= Math.max(2, Math.floor(handle.length / 3))
    ? `unknown external source "${handle}"; did you mean "${suggestion.candidate}"?`
    : `unknown external source "${handle}"`;
}

function cacheRoot(latDir: string): string {
  return join(latDir, '.cache', 'external');
}

export function externalCachePaths(latDir: string, handle: string) {
  const root = cacheRoot(latDir);
  return {
    root,
    directory: join(root, handle),
    metadata: join(root, `${handle}.json`),
  };
}

export function readExternalCacheMetadata(
  latDir: string,
  handle: string,
): ExternalCacheMetadata | null {
  try {
    const value = JSON.parse(
      readFileSync(externalCachePaths(latDir, handle).metadata, 'utf8'),
    ) as ExternalCacheMetadata;
    if (
      value.ver !== EXTERNAL_SOURCES_SCHEMA_VER ||
      typeof value.source !== 'string' ||
      value.source.length === 0 ||
      !COMMIT_RE.test(value.commit) ||
      !['fetch', 'checkout', 'local'].includes(value.strategy)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

const sourceLocks = new Map<string, Promise<void>>();
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 10 * 60_000;
const LOCK_OWNER_GRACE_MS = 1_000;

type FilesystemLockOwner = {
  owner: string;
  pid: number;
  startedAt: number;
};

async function filesystemLockOwner(
  path: string,
): Promise<FilesystemLockOwner | null> {
  try {
    const value = JSON.parse(
      await readFile(join(path, 'owner.json'), 'utf8'),
    ) as Partial<FilesystemLockOwner> | null;
    if (
      !value ||
      typeof value.owner !== 'string' ||
      !Number.isInteger(value.pid) ||
      value.pid! <= 0 ||
      !Number.isFinite(value.startedAt)
    ) {
      return null;
    }
    return value as FilesystemLockOwner;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function discardFilesystemLock(path: string): Promise<void> {
  const discarded = `${path}.stale-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await rename(path, discarded);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await rm(discarded, { recursive: true, force: true });
}

async function acquireFilesystemLock(
  key: string,
): Promise<() => Promise<void>> {
  const path = `${key}.lock`;
  const owner = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(dirname(path), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      await mkdir(path);
      await writeFile(
        join(path, 'owner.json'),
        `${JSON.stringify({ owner, pid: process.pid, startedAt: Date.now() })}\n`,
      );
      return async () => {
        try {
          const value = JSON.parse(
            await readFile(join(path, 'owner.json'), 'utf8'),
          ) as { owner?: unknown };
          if (value.owner === owner) {
            await rm(path, { recursive: true, force: true });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const age = Date.now() - statSync(path).mtimeMs;
        const currentOwner = await filesystemLockOwner(path);
        if (
          age > LOCK_STALE_MS ||
          (currentOwner && !processIsAlive(currentOwner.pid)) ||
          (!currentOwner && age > LOCK_OWNER_GRACE_MS)
        ) {
          await discardFilesystemLock(path);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw statError;
        }
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for external cache lock "${path}"`);
      }
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, LOCK_RETRY_MS),
      );
    }
  }
}

async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = sourceLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => (release = resolveLock));
  const tail = previous.then(() => current);
  sourceLocks.set(key, tail);
  await previous;
  let releaseFilesystem: (() => Promise<void>) | undefined;
  try {
    releaseFilesystem = await acquireFilesystemLock(key);
    return await fn();
  } finally {
    await releaseFilesystem?.();
    release();
    if (sourceLocks.get(key) === tail) sourceLocks.delete(key);
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

function expectedMetadata(
  source: EffectiveExternalSource,
): ExternalCacheMetadata {
  return {
    ver: EXTERNAL_SOURCES_SCHEMA_VER,
    source: source.source,
    commit: source.commit,
    strategy: source.effectiveStrategy,
  };
}

function sameMetadata(
  left: ExternalCacheMetadata | null,
  right: ExternalCacheMetadata,
): boolean {
  return (
    !!left &&
    left.ver === right.ver &&
    left.source === right.source &&
    left.commit === right.commit &&
    left.strategy === right.strategy
  );
}

async function initializeCheckout(
  directory: string,
  source: EffectiveExternalSource,
): Promise<void> {
  await git(['init', '--bare', directory]);
  await git(['-C', directory, 'remote', 'add', 'origin', source.repo]);
  await git(['-C', directory, 'config', 'remote.origin.promisor', 'true']);
  await git([
    '-C',
    directory,
    'config',
    'remote.origin.partialclonefilter',
    'blob:none',
  ]);
  await git([
    '-C',
    directory,
    'fetch',
    '--depth=1',
    '--filter=blob:none',
    '--no-tags',
    'origin',
    source.commit,
  ]);
  await git(['-C', directory, 'update-ref', 'refs/lat/commit', 'FETCH_HEAD']);
}

async function checkoutHasUnsafeUrlRewrite(
  directory: string,
): Promise<boolean> {
  try {
    const value = await git([
      '-C',
      directory,
      'config',
      '--local',
      '--name-only',
      '--get-regexp',
      '^url\\.',
    ]);
    return value.length > 0;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

async function ensureGenerationUnlocked(
  latDir: string,
  source: EffectiveExternalSource,
): Promise<string> {
  const paths = externalCachePaths(latDir, source.handle);
  await mkdir(paths.root, { recursive: true });
  const expected = expectedMetadata(source);
  let current = readExternalCacheMetadata(latDir, source.handle);
  if (
    sameMetadata(current, expected) &&
    source.effectiveStrategy === 'checkout'
  ) {
    try {
      const origin = await git([
        '-C',
        paths.directory,
        'remote',
        'get-url',
        'origin',
      ]);
      if (
        normalizeExternalRepoUrl(origin) !== source.repo ||
        (await checkoutHasUnsafeUrlRewrite(paths.directory))
      )
        current = null;
    } catch {
      current = null;
    }
  }
  const directoryCorrect =
    source.effectiveStrategy === 'local'
      ? !existsSync(paths.directory)
      : existsSync(paths.directory);
  if (sameMetadata(current, expected) && directoryCorrect)
    return paths.directory;

  await rm(paths.directory, { recursive: true, force: true });
  await rm(paths.metadata, { force: true });
  if (source.effectiveStrategy !== 'local') {
    if (source.effectiveStrategy === 'checkout') {
      const staging = `${paths.directory}.staging-${process.pid}-${Date.now()}`;
      try {
        await initializeCheckout(staging, source);
        await rename(staging, paths.directory);
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    } else {
      await mkdir(paths.directory, { recursive: true });
    }
  }
  await atomicJson(paths.metadata, expected);
  return paths.directory;
}

async function validateRemovedCaches(
  snapshot: ExternalSourcesSnapshot,
  latDir: string,
) {
  if (!snapshot.validCanonical) return;
  const root = cacheRoot(latDir);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const handle = entry.slice(0, -5);
    if (!HANDLE_RE.test(handle) || snapshot.sources.has(handle)) continue;
    const paths = externalCachePaths(latDir, handle);
    await serialized(paths.metadata, async () => {
      await rm(paths.directory, { recursive: true, force: true });
      await rm(paths.metadata, { force: true });
    });
  }
}

function fetchUrl(source: EffectiveExternalSource, path: string): URL {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return new URL(
    source
      .fetchUrl!.replaceAll('{commit}', source.commit)
      .replaceAll('{path}', encodedPath),
  );
}

async function readHttps(
  url: URL,
  redirects = 0,
  ca?: string | Buffer,
): Promise<{ bytes: Buffer; contentType: string }> {
  validateHttpsUrl(url, 'external file URL');
  if (redirects > MAX_REDIRECTS) throw new Error('too many redirects');
  return new Promise((resolveResponse, reject) => {
    const request = httpsRequest(
      url,
      {
        ca,
        headers: { accept: 'application/octet-stream', 'user-agent': 'lat.md' },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          const location = response.headers.location;
          if (!location)
            return reject(new Error(`redirect ${status} has no location`));
          let next: URL;
          try {
            next = new URL(location, url);
            validateHttpsUrl(next, 'redirect');
          } catch (error) {
            return reject(error);
          }
          void readHttps(next, redirects + 1, ca).then(resolveResponse, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        const length = Number(response.headers['content-length'] ?? 0);
        if (length > MAX_BYTES) {
          response.destroy();
          reject(new Error(`response exceeds ${MAX_BYTES} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            response.destroy(new Error(`response exceeds ${MAX_BYTES} bytes`));
          } else chunks.push(chunk);
        });
        response.on('end', () =>
          resolveResponse({
            bytes: Buffer.concat(chunks),
            contentType: String(response.headers['content-type'] ?? '')
              .split(';', 1)[0]
              .trim()
              .toLowerCase(),
          }),
        );
        response.on('error', reject);
      },
    );
    request.setTimeout(HTTP_TIMEOUT_MS, () =>
      request.destroy(new Error('external read timed out')),
    );
    request.on('error', reject);
    request.end();
  });
}

function assertNoSymlinks(root: string, file: string): string {
  const rootReal = realpathSync(root);
  const rel = relative(root, file);
  let cursor = root;
  for (const part of rel.split(/[\\/]/)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink())
      throw new Error('external local path contains a symlink');
  }
  const real = realpathSync(file);
  if (
    relative(rootReal, real).startsWith('..') ||
    isAbsolute(relative(rootReal, real))
  ) {
    throw new Error('external local path escapes the checkout');
  }
  return real;
}

async function readProviderContent(
  latDir: string,
  projectRoot: string,
  source: EffectiveExternalSource,
  target: ExternalTarget,
  ca?: string | Buffer,
  ignoreLocal = false,
): Promise<{ content: string; provider: EffectiveExternalStrategy }> {
  const paths = externalCachePaths(latDir, source.handle);
  return serialized(paths.metadata, async () => {
    await assertCurrentGeneration(latDir, projectRoot, source, ignoreLocal);
    const directory = await ensureGenerationUnlocked(latDir, source);
    let content: string;
    if (source.effectiveStrategy === 'local') {
      const path = assertNoSymlinks(
        source.localPath!,
        join(source.localPath!, target.repositoryPath),
      );
      content = await readFile(path, 'utf8');
    } else if (source.effectiveStrategy === 'checkout') {
      content = await git(
        ['-C', directory, 'show', `${source.commit}:${target.repositoryPath}`],
        { maxBuffer: MAX_BYTES + 1024, trim: false },
      );
    } else {
      const path = join(directory, ...target.repositoryPath.split('/'));
      try {
        content = await readFile(path, 'utf8');
      } catch {
        const response = await readHttps(
          fetchUrl(source, target.repositoryPath),
          0,
          ca,
        );
        if (response.contentType === 'text/html') {
          throw new Error(
            `fetch-url returned HTML for "${target.repositoryPath}" instead of raw file bytes; configure a raw-file URL or use strategy: checkout`,
          );
        }
        content = new TextDecoder('utf-8', { fatal: true }).decode(
          response.bytes,
        );
        await mkdir(dirname(path), { recursive: true });
        const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, content);
        await rename(temp, path);
      }
    }
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new Error(`external file exceeds ${MAX_BYTES} bytes`);
    await assertCurrentGeneration(latDir, projectRoot, source, ignoreLocal);
    return { content, provider: source.effectiveStrategy };
  });
}

async function assertCurrentGeneration(
  latDir: string,
  projectRoot: string,
  source: EffectiveExternalSource,
  ignoreLocal: boolean,
): Promise<void> {
  const current = await loadExternalSources(latDir, projectRoot, {
    ignoreLocal,
  });
  const selected = current.sources.get(source.handle);
  if (
    !current.validCanonical ||
    !selected ||
    !sameMetadata(expectedMetadata(selected), expectedMetadata(source))
  ) {
    throw new Error(
      `external source "${source.handle}" configuration changed during retrieval`,
    );
  }
}

function sourceSymbol(
  symbols: SourceSymbol[],
  fragment: string,
): SourceSymbol | undefined {
  const parts = fragment.split('#');
  if (parts.length === 1)
    return symbols.find((item) => item.name === parts[0] && !item.parent);
  if (parts.length === 2)
    return symbols.find(
      (item) => item.parent === parts[0] && item.name === parts[1],
    );
  return undefined;
}

async function selectFragment(
  target: ExternalTarget,
  fullContent: string,
  latDir: string,
  externalDocumentParserRuntime: ExternalDocumentParserRuntime,
  sourceParserRuntime: SourceParserRuntime,
  onDocumentAnalyzed?: (analysis: ExternalDocumentFileAnalysis) => void,
  onParserImport?: ParserImportObserver,
): Promise<
  | {
      content: string;
      startLine: number;
      endLine: number;
      kind: 'document';
      document: ExternalDocumentAnalysis;
    }
  | {
      content: string;
      startLine: number;
      endLine: number;
      kind: 'source';
      signature?: string;
    }
> {
  const lines = fullContent.split('\n');
  if (isDocumentPath(target.resolvedPath)) {
    const { document } = await analyzeExternalDocumentCached(
      target.resolvedPath,
      fullContent,
      latDir,
      {
        identity: `@external/${target.handle}/${target.resolvedPath}`,
        runtime: externalDocumentParserRuntime,
        onFileAnalyzed: onDocumentAnalyzed,
        onParserImport,
      },
    );
    if (!target.fragment)
      return {
        content: fullContent,
        startLine: 1,
        endLine: lines.length,
        kind: 'document',
        document,
      };
    const match = findExternalDocumentSection(document, target.fragment);
    if (!match)
      throw new Error(
        `document heading or anchor "${target.fragment}" not found in "${target.resolvedPath}"`,
      );
    return {
      content: lines.slice(match.startLine - 1, match.endLine).join('\n'),
      startLine: match.startLine,
      endLine: match.endLine,
      kind: 'document',
      document,
    };
  }
  if (!target.fragment)
    return {
      content: fullContent,
      startLine: 1,
      endLine: lines.length,
      kind: 'source',
    };
  const { symbols } = await analyzeSourceSymbols(
    target.resolvedPath,
    fullContent,
    latDir,
    {
      identity: `@external/${target.handle}/${target.resolvedPath}`,
      runtime: sourceParserRuntime,
    },
  );
  const symbol = sourceSymbol(symbols, target.fragment);
  if (!symbol)
    throw new Error(
      `symbol "${target.fragment}" not found in "${target.resolvedPath}"`,
    );
  return {
    content: lines.slice(symbol.startLine - 1, symbol.endLine).join('\n'),
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    kind: 'source',
    signature: symbol.signature,
  };
}

export class ExternalResolver {
  private reconciliationPromise?: Promise<void>;
  private readonly externalFilePromises = new Map<
    string,
    Promise<{ content: string; provider: EffectiveExternalStrategy }>
  >();
  private readonly externalDocumentParserRuntime =
    new ExternalDocumentParserRuntime();
  private readonly sourceParserRuntime = new SourceParserRuntime();

  constructor(
    readonly latDir: string,
    readonly projectRoot: string,
    readonly snapshot: ExternalSourcesSnapshot,
    private readonly ca?: string | Buffer,
    private readonly ignoreLocal = false,
    private readonly onDocumentAnalyzed?: (
      analysis: ExternalDocumentFileAnalysis,
    ) => void,
    private readonly onParserImport?: ParserImportObserver,
  ) {}

  parse(target: string): ExternalTarget | null {
    return parseExternalTarget(target, this.snapshot);
  }

  unknownTargetMessage(target: string): string | null {
    return unknownExternalHandle(target, this.snapshot);
  }

  reconcile(): Promise<void> {
    this.reconciliationPromise ??= validateRemovedCaches(
      this.snapshot,
      this.latDir,
    );
    return this.reconciliationPromise;
  }

  private readFile(
    source: EffectiveExternalSource,
    target: ExternalTarget,
  ): Promise<{ content: string; provider: EffectiveExternalStrategy }> {
    const key = `${source.handle}\0${target.repositoryPath}`;
    let loaded = this.externalFilePromises.get(key);
    if (!loaded) {
      loaded = readProviderContent(
        this.latDir,
        this.projectRoot,
        source,
        target,
        this.ca,
        this.ignoreLocal,
      );
      this.externalFilePromises.set(key, loaded);
    }
    return loaded;
  }

  async resolve(targetValue: string): Promise<ResolvedExternalContent> {
    const target = this.parse(targetValue);
    if (!target) throw new Error(`unknown external target "${targetValue}"`);
    const source = this.snapshot.sources.get(target.handle)!;
    await this.reconcile();
    try {
      const loaded = await this.readFile(source, target);
      const fragment = await selectFragment(
        target,
        loaded.content,
        this.latDir,
        this.externalDocumentParserRuntime,
        this.sourceParserRuntime,
        this.onDocumentAnalyzed,
        this.onParserImport,
      );
      return {
        target,
        source,
        provider: loaded.provider,
        fullContent: loaded.content,
        ...fragment,
      };
    } catch (error) {
      throw new Error(
        `external source "${source.handle}" could not read "${target.repositoryPath}" at ${source.commit} via ${source.effectiveStrategy}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
}

export async function createExternalResolver(
  latDir: string,
  projectRoot = dirname(latDir),
  options: {
    ignoreLocal?: boolean;
    ca?: string | Buffer;
    onDocumentAnalyzed?: (analysis: ExternalDocumentFileAnalysis) => void;
    onParserImport?: ParserImportObserver;
  } = {},
): Promise<ExternalResolver> {
  return new ExternalResolver(
    latDir,
    projectRoot,
    await loadExternalSources(latDir, projectRoot, options),
    options.ca,
    options.ignoreLocal,
    options.onDocumentAnalyzed,
    options.onParserImport,
  );
}

export type ExternalSourceDescription = {
  handle: string;
  repo: string;
  canonicalCommit: string;
  effectiveCommit: string;
  prefix: string;
  defaultFileExtension?: string;
  strategy: ExternalStrategy;
  effectiveStrategy: EffectiveExternalStrategy;
  fetchUrl?: string;
  localPath?: string;
  localError?: string;
  cache: ExternalCacheMetadata | null;
  checkout: { command: string; args: string[] }[];
};

export function describeExternalSources(
  latDir: string,
  snapshot: ExternalSourcesSnapshot,
): ExternalSourceDescription[] {
  return [...snapshot.sources.values()].map((source) => ({
    handle: source.handle,
    repo: source.repo,
    canonicalCommit: source.canonicalCommit,
    effectiveCommit: source.commit,
    prefix: source.prefix,
    ...(source.defaultFileExtension
      ? { defaultFileExtension: source.defaultFileExtension }
      : {}),
    strategy: source.strategy,
    effectiveStrategy: source.effectiveStrategy,
    ...(source.fetchUrl ? { fetchUrl: source.fetchUrl } : {}),
    ...(source.localPath ? { localPath: source.localPath } : {}),
    ...(source.localError ? { localError: source.localError } : {}),
    cache: readExternalCacheMetadata(latDir, source.handle),
    checkout: [
      {
        command: 'git',
        args: [
          'clone',
          '--filter=blob:none',
          '--sparse',
          source.repo,
          source.handle,
        ],
      },
      ...(source.prefix
        ? [
            {
              command: 'git',
              args: [
                '-C',
                source.handle,
                'sparse-checkout',
                'set',
                source.prefix,
              ],
            },
          ]
        : []),
      {
        command: 'git',
        args: ['-C', source.handle, 'checkout', '--detach', source.commit],
      },
    ],
  }));
}

export async function resolveExternalCommit(
  repo: string,
  ref: string,
): Promise<string> {
  const normalized = normalizeExternalRepoUrl(repo);
  const actual = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), 'lat-external-ref-')),
  );
  try {
    await git(['init', '--bare', actual]);
    await git([
      '-C',
      actual,
      'fetch',
      '--depth=1',
      '--filter=blob:none',
      '--no-tags',
      normalized,
      ref,
    ]);
    const commit = await git([
      '-C',
      actual,
      'rev-parse',
      'FETCH_HEAD^{commit}',
    ]);
    if (!COMMIT_RE.test(commit))
      throw new Error('remote ref did not resolve to a full commit');
    return commit;
  } finally {
    await rm(actual, { recursive: true, force: true });
  }
}

export async function addCanonicalExternalSource(
  latDir: string,
  input: {
    handle: string;
    repo: string;
    commit: string;
    prefix?: string;
    defaultFileExtension?: string;
    strategy: ExternalStrategy;
    fetchUrl?: string;
  },
): Promise<CanonicalExternalSource> {
  const path = join(latDir, 'lat.md');
  const content = await readFile(path, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const document = parseDocument(match?.[1] ?? '');
  const existing = document.getIn(['lat', 'external-sources', input.handle]);
  if (existing !== undefined)
    throw new Error(`external source "${input.handle}" already exists`);
  const source = sourceFromValue(input.handle, {
    repo: input.repo,
    commit: input.commit,
    ...(input.prefix ? { prefix: input.prefix } : {}),
    ...(input.defaultFileExtension
      ? { 'default-file-extension': input.defaultFileExtension }
      : {}),
    strategy: input.strategy,
    ...(input.fetchUrl ? { 'fetch-url': input.fetchUrl } : {}),
  });
  document.setIn(['lat', 'external-sources', input.handle], {
    repo: source.repo,
    commit: source.commit,
    ...(source.prefix ? { prefix: source.prefix } : {}),
    ...(source.defaultFileExtension
      ? { 'default-file-extension': source.defaultFileExtension }
      : {}),
    strategy: source.strategy,
    ...(input.fetchUrl ? { 'fetch-url': input.fetchUrl } : {}),
  });
  const nextFrontmatter = document.toString().trimEnd();
  const body = match ? content.slice(match[0].length) : content;
  const next = `---\n${nextFrontmatter}\n---\n${body}`;
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, next);
  await rename(temp, path);
  return source;
}
