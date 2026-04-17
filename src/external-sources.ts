import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

export type ExternalSource = {
  repo?: string;
  rev?: string;
  browse?: string;
  path?: string;
};

export type ExternalSourcesState = {
  rootConfigPath: string;
  localConfigPath: string;
  sources: Record<string, ExternalSource>;
  errors: { file: string; message: string }[];
};

export type LoadExternalSourcesOptions = {
  ignoreLocalOverrides?: boolean;
};

export type ExternalTarget = {
  target: string;
  handle: string;
  path: string;
  fragment: string;
  source: ExternalSource;
};

export type ExternalResolution = {
  target: string;
  handle: string;
  repo?: string;
  rev?: string;
  path: string;
  fragment: string;
  browseUrl: string;
  activeTarget: string;
  activeKind: 'local' | 'canonical';
  localPath?: string;
  localFileUrl?: string;
  line?: number;
  endLine?: number;
};

export type ExternalSourceHandleResolution = {
  handle: string;
  repo?: string;
  rev?: string;
  localPath?: string;
  activeKind: 'local' | 'canonical';
  activeTarget: string;
};

type LocalSourceValidation = {
  repoPath: string;
  head: string;
  resolvedRev: string;
  error?: string;
};

const localSourceCache = new Map<string, LocalSourceValidation>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSourceConfig(value: unknown): ExternalSource | null {
  if (!isRecord(value)) return null;
  const source: ExternalSource = {};
  if (typeof value.repo === 'string') source.repo = value.repo;
  if (typeof value.rev === 'string') source.rev = value.rev;
  if (typeof value.browse === 'string') source.browse = value.browse;
  if (typeof value.path === 'string') source.path = value.path;
  return source;
}

function parseCanonicalExternalSources(
  content: string,
): Record<string, ExternalSource> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const parsed = parseYaml(match[1]);
  if (!isRecord(parsed) || !isRecord(parsed.lat)) return {};

  const raw = parsed.lat['external-sources'];
  if (!isRecord(raw)) return {};

  const sources: Record<string, ExternalSource> = {};
  for (const [handle, value] of Object.entries(raw)) {
    const source = normalizeSourceConfig(value);
    if (source) sources[handle] = source;
  }
  return sources;
}

function parseLocalExternalSources(
  content: string,
): Record<string, ExternalSource> {
  const parsed = JSON.parse(content);
  if (!isRecord(parsed) || !isRecord(parsed.lat)) return {};

  const raw = parsed.lat['external-sources'];
  if (!isRecord(raw)) return {};

  const sources: Record<string, ExternalSource> = {};
  for (const [handle, value] of Object.entries(raw)) {
    const source = normalizeSourceConfig(value);
    if (source?.path) {
      sources[handle] = { path: source.path };
    }
  }
  return sources;
}

export function getProjectLocalConfigPath(projectRoot: string): string {
  return join(projectRoot, 'lat.md', 'config.local.json');
}

export function loadExternalSources(
  projectRoot: string,
  opts: LoadExternalSourcesOptions = {},
): ExternalSourcesState {
  const rootConfigPath = join(projectRoot, 'lat.md', 'lat.md');
  const localConfigPath = getProjectLocalConfigPath(projectRoot);
  const errors: { file: string; message: string }[] = [];
  let canonical: Record<string, ExternalSource> = {};
  let local: Record<string, ExternalSource> = {};

  if (existsSync(rootConfigPath)) {
    try {
      canonical = parseCanonicalExternalSources(
        readFileSync(rootConfigPath, 'utf-8'),
      );
    } catch (err) {
      errors.push({
        file: rootConfigPath,
        message: `invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (!opts.ignoreLocalOverrides && existsSync(localConfigPath)) {
    try {
      local = parseLocalExternalSources(readFileSync(localConfigPath, 'utf-8'));
    } catch (err) {
      errors.push({
        file: localConfigPath,
        message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const sources: Record<string, ExternalSource> = {};
  for (const handle of new Set([
    ...Object.keys(canonical),
    ...Object.keys(local),
  ])) {
    sources[handle] = { ...canonical[handle], ...local[handle] };
  }

  return { rootConfigPath, localConfigPath, sources, errors };
}

export function parseExternalTarget(
  target: string,
  sources: Record<string, ExternalSource>,
): ExternalTarget | null {
  const colon = target.indexOf(':');
  if (colon <= 0) return null;
  const handle = target.slice(0, colon);
  const source = sources[handle];
  if (!source) return null;

  const rest = target.slice(colon + 1);
  if (!rest) return null;

  const hash = rest.indexOf('#');
  return {
    target,
    handle,
    path: hash === -1 ? rest : rest.slice(0, hash),
    fragment: hash === -1 ? '' : rest.slice(hash + 1),
    source,
  };
}

export function getConfiguredExternalPaths(projectRoot: string): string[] {
  const { sources } = loadExternalSources(projectRoot);
  return [
    ...new Set(
      Object.values(sources)
        .map((s) => expandHomePath(s.path))
        .filter((p): p is string => typeof p === 'string' && p.length > 0),
    ),
  ];
}

export function expandHomePath(
  pathValue: string | undefined,
): string | undefined {
  if (!pathValue) return pathValue;
  if (pathValue === '~') return homedir();
  if (pathValue.startsWith('~/')) return join(homedir(), pathValue.slice(2));
  return pathValue;
}

function validateLocalSource(
  source: ExternalSource,
): LocalSourceValidation | null {
  if (!source.path || !source.rev) return null;

  const configuredPath = expandHomePath(source.path);
  if (!configuredPath) return null;

  const key = `${configuredPath}\0${source.rev}`;
  const cached = localSourceCache.get(key);
  if (cached) return cached;

  const result: LocalSourceValidation = {
    repoPath: resolve(configuredPath),
    head: '',
    resolvedRev: '',
  };

  try {
    if (!existsSync(result.repoPath)) {
      result.error = `local path "${result.repoPath}" does not exist`;
    } else if (!statSync(result.repoPath).isDirectory()) {
      result.error = `local path "${result.repoPath}" is not a directory`;
    } else {
      result.resolvedRev = execFileSync(
        'git',
        ['-C', result.repoPath, 'rev-parse', `${source.rev}^{commit}`],
        { encoding: 'utf-8' },
      ).trim();
      result.head = execFileSync(
        'git',
        ['-C', result.repoPath, 'rev-parse', 'HEAD'],
        {
          encoding: 'utf-8',
        },
      ).trim();
      if (result.head !== result.resolvedRev) {
        result.error = `local path "${result.repoPath}" is at ${result.head.slice(0, 12)} but expected ${result.resolvedRev.slice(0, 12)} for rev "${source.rev}"`;
      }
    }
  } catch (err) {
    result.error =
      err instanceof Error && err.message
        ? `failed to validate local path "${result.repoPath}": ${err.message}`
        : `failed to validate local path "${result.repoPath}"`;
  }

  localSourceCache.set(key, result);
  return result;
}

function formatBrowseUrl(target: ExternalTarget): string {
  const template = target.source.browse ?? '';
  return template
    .replaceAll('{path}', target.path)
    .replaceAll('{fragment}', target.fragment)
    .replaceAll('{rev}', target.source.rev ?? '')
    .replaceAll('{repo}', target.source.repo ?? '')
    .replace(/#$/, '')
    .replace(/[?&]$/, '');
}

export function parseLineFragment(
  fragment: string,
): { line: number; endLine?: number } | null {
  const match = fragment.match(/^L(\d+)(?:-L?(\d+))?$/i);
  if (!match) return null;
  const line = Number(match[1]);
  const endLine = match[2] ? Number(match[2]) : undefined;
  return endLine && endLine !== line ? { line, endLine } : { line };
}

type AsciiDocSection = {
  level: number;
  title: string;
  ids: string[];
  line: number;
  endLine: number;
};

function isAsciiDocPath(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.adoc' || ext === '.asciidoc';
}

function normalizeAsciiDocHeadingTitle(title: string): string {
  return title
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function autoAsciiDocId(title: string, seen: Set<string>): string {
  const stem = normalizeAsciiDocHeadingTitle(title)
    .toLowerCase()
    .replace(/[^\w .-]+/g, '')
    .replace(/[ .-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
  const base = stem ? `_${stem}` : '_section';

  let candidate = base;
  let suffix = 2;
  while (seen.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix++;
  }
  seen.add(candidate);
  return candidate;
}

function parseStandaloneAsciiDocId(line: string): string | null {
  const trimmed = line.trim();
  const blockAnchor = trimmed.match(/^\[\[([^,\]]+)(?:,[^\]]*)?\]\]$/);
  if (blockAnchor) return blockAnchor[1];

  const shorthand = trimmed.match(/^\[#([^,\]]+)(?:,[^\]]*)?\]$/);
  if (shorthand) return shorthand[1];

  const named = trimmed.match(/^\[(?:[^\]]*,)?id=([^,\]]+)(?:,[^\]]*)?\]$/);
  if (named) return named[1];

  return null;
}

function parseAsciiDocSections(content: string): AsciiDocSection[] {
  const lines = content.split('\n');
  const sections: AsciiDocSection[] = [];
  const seenIds = new Set<string>();
  let pendingId: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const standaloneId = parseStandaloneAsciiDocId(line);
    if (standaloneId) {
      pendingId = standaloneId;
      continue;
    }

    const heading = line.match(/^(={1,6})\s+(.+?)\s*$/);
    if (!heading) {
      if (line.trim() !== '') pendingId = null;
      continue;
    }

    const rawTitle = heading[2];
    const inlineIds = [
      ...rawTitle.matchAll(/\[\[([^,\]]+)(?:,[^\]]*)?\]\]/g),
    ].map((match) => match[1]);
    const title = normalizeAsciiDocHeadingTitle(rawTitle);
    const primaryId = pendingId ?? autoAsciiDocId(title, seenIds);
    if (pendingId) seenIds.add(primaryId);
    const ids = [primaryId, ...inlineIds.filter((id) => id !== primaryId)];

    sections.push({
      level: heading[1].length,
      title,
      ids,
      line: i + 1,
      endLine: lines.length,
    });
    pendingId = null;
  }

  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j].level <= sections[i].level) {
        sections[i].endLine = sections[j].line - 1;
        break;
      }
    }
  }

  return sections;
}

function parseAsciiDocFragment(
  filePath: string,
  fragment: string,
): { line: number; endLine?: number } | null {
  if (!fragment || !isAsciiDocPath(filePath) || !existsSync(filePath))
    return null;

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const sections = parseAsciiDocSections(content);
  const match = sections.find((section) => section.ids.includes(fragment));
  if (!match) return null;
  return match.endLine !== match.line
    ? { line: match.line, endLine: match.endLine }
    : { line: match.line };
}

function parseExternalFragment(
  localPath: string | undefined,
  target: ExternalTarget,
): { line: number; endLine?: number } | null {
  return (
    parseLineFragment(target.fragment) ||
    (localPath ? parseAsciiDocFragment(localPath, target.fragment) : null)
  );
}

export function resolveExternalTarget(
  target: ExternalTarget,
): ExternalResolution {
  const browseUrl = formatBrowseUrl(target);
  const local = validateLocalSource(target.source);
  const localPath =
    local && !local.error ? join(local.repoPath, target.path) : undefined;
  const lineInfo = parseExternalFragment(localPath, target);

  if (local && !local.error) {
    const localFileUrl =
      pathToFileURL(localPath!).toString() +
      (target.fragment ? `#${target.fragment}` : '');
    return {
      target: target.target,
      handle: target.handle,
      repo: target.source.repo,
      rev: target.source.rev,
      path: target.path,
      fragment: target.fragment,
      browseUrl,
      activeTarget: localFileUrl,
      activeKind: 'local',
      localPath,
      localFileUrl,
      line: lineInfo?.line,
      endLine: lineInfo?.endLine,
    };
  }

  return {
    target: target.target,
    handle: target.handle,
    repo: target.source.repo,
    rev: target.source.rev,
    path: target.path,
    fragment: target.fragment,
    browseUrl,
    activeTarget: browseUrl,
    activeKind: 'canonical',
    line: lineInfo?.line,
    endLine: lineInfo?.endLine,
  };
}

export function resolveExternalSourceHandle(
  handle: string,
  source: ExternalSource,
): ExternalSourceHandleResolution | null {
  const local = validateLocalSource(source);
  if (local && !local.error) {
    return {
      handle,
      repo: source.repo,
      rev: source.rev,
      localPath: local.repoPath,
      activeKind: 'local',
      activeTarget: local.repoPath,
    };
  }

  if (!source.repo) return null;

  return {
    handle,
    repo: source.repo,
    rev: source.rev,
    activeKind: 'canonical',
    activeTarget: source.repo,
  };
}

export function validateExternalSources(
  state: ExternalSourcesState,
): { file: string; message: string; handle?: string }[] {
  const errors: { file: string; message: string; handle?: string }[] = [
    ...state.errors,
  ];

  for (const [handle, source] of Object.entries(state.sources)) {
    const missing: string[] = [];
    if (!source.repo) missing.push('repo');
    if (!source.rev) missing.push('rev');
    if (!source.browse) missing.push('browse');

    if (missing.length > 0) {
      errors.push({
        file: state.rootConfigPath,
        handle,
        message: `external source "${handle}" is missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      });
    }

    const local = validateLocalSource(source);
    if (local?.error) {
      errors.push({
        file: state.localConfigPath,
        handle,
        message: `external source "${handle}": ${local.error}`,
      });
    }
  }

  return errors;
}
