import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CmdContext } from '../context.js';
import { isDocumentPath } from '../document-formats.js';
import type { ExternalResolver } from '../external-sources.js';
import type {
  ViewDocument,
  ViewExternalDocument,
  ViewGraph,
  ViewMarkdownBackReference,
  ViewSectionBackReference,
  ViewSourceDocument,
  ViewSourceReference,
} from './protocol.js';
import { DEFAULT_VIEW_LOGO_TEXT } from './protocol.js';
import { documentTreeUrls, rewriteDocumentTreeUrls } from './document-tree.js';
import {
  VIEW_STATIC_BOOTSTRAP_ID,
  viewStaticDocumentRequest,
  viewStaticSourceKey,
  type ViewStaticBootstrap,
  type ViewStaticExternalSourceView,
  type ViewStaticManifest,
  type ViewStaticSourceRequest,
} from './static-protocol.js';
import { createViewStore } from './store.js';
import { rewriteClientAssetUrls } from './client-shell.js';
import {
  documentResourcePath,
  documentPath,
  documentUrl,
  rawDocumentPath,
  validateDocumentRoutes,
} from './document-route.js';

const defaultClientDir = fileURLToPath(new URL('./client/', import.meta.url));
const VIEW_BUILD_MOVE_MAX_RETRIES = 10;
const VIEW_BUILD_MOVE_RETRY_DELAY_MS = 150;

export type StaticViewBuildOptions = {
  basePath?: string;
  clientDir?: string;
  codeExcludePaths?: string[];
  force?: boolean;
  logoText?: string;
  externalCa?: string | Buffer;
  searchApi?: string;
};

export type StaticViewBuildResult = {
  documents: number;
  outputDir: string;
  sources: number;
};

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`));
}

export function normalizeStaticViewBasePath(value: string): string {
  const path = value.startsWith('/') ? value : `/${value}`;
  const parsed = new URL(path, 'http://lat.local');
  if (
    parsed.origin !== 'http://lat.local' ||
    parsed.search ||
    parsed.hash ||
    value.includes('://')
  ) {
    throw new Error('Static UI base path must be an absolute URL path');
  }
  return parsed.pathname.endsWith('/')
    ? parsed.pathname
    : `${parsed.pathname}/`;
}

function staticViewPayloadDir(outputDir: string, basePath: string): string {
  const segments = basePath
    .slice(1, -1)
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('/') ||
        decoded.includes('\\')
      ) {
        throw new Error('Static UI base path contains an unsafe segment');
      }
      return decoded;
    });
  return join(outputDir, ...segments);
}

function decodeHtmlUrlAttribute(value: string): string {
  return value.replace(/&(amp|#38|#x26);/gi, '&');
}

/** Convert a live view route to its physical static-directory URL. */
export function staticViewUrl(
  value: string,
  basePath: string,
  entryPath?: string,
): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return value;
  let url: URL;
  try {
    url = new URL(decodeHtmlUrlAttribute(value), 'http://lat.local');
  } catch {
    return value;
  }
  if (url.origin !== 'http://lat.local') return value;

  const markdownPath = documentPath(url.pathname.replace(/\/$/, ''));
  if (markdownPath || rawDocumentPath(url.pathname)) {
    const route = url.pathname.slice(1).replace(/\/+$/, '');
    const suffix = `${url.search}${url.hash}`;
    if (entryPath && markdownPath === entryPath) {
      return `${basePath}${suffix}`;
    }
    return `${basePath}${route}${suffix}`;
  }
  if (url.pathname.startsWith('/resources/')) {
    const route = url.pathname.slice(1);
    return `${basePath}${route}${url.search}${url.hash}`;
  }
  for (const prefix of ['/code/', '/external/'] as const) {
    if (!url.pathname.startsWith(prefix)) continue;
    const route = url.pathname.slice(1).replace(/\/+$/, '');
    return `${basePath}${route}/${url.search}${url.hash}`;
  }
  if (url.pathname === '/graph') {
    return `${basePath}graph/${url.search}${url.hash}`;
  }
  if (url.pathname === '/' || url.pathname === '/search') {
    return `${basePath}${url.pathname.slice(1)}${url.search}${url.hash}`;
  }
  return value;
}

function documentPathFromUrl(value: URL): string | null {
  return documentPath(value.pathname) ?? rawDocumentPath(value.pathname);
}

function rewriteHtmlLink(
  value: string,
  basePath: string,
  entryPath: string,
  sourcePath: string | null,
  documentPaths: ReadonlySet<string>,
): string {
  const direct = staticViewUrl(value, basePath, entryPath);
  if (direct !== value || !sourcePath || value.startsWith('#')) return direct;

  let resolved: URL;
  try {
    const externalAt = sourcePath.indexOf(':');
    const currentRoute =
      externalAt > 0 && !documentPaths.has(sourcePath)
        ? `/external/${encodeURIComponent(sourcePath.slice(0, externalAt))}/${sourcePath
            .slice(externalAt + 1)
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`
        : documentUrl(sourcePath);
    resolved = new URL(
      decodeHtmlUrlAttribute(value),
      `http://lat.local${currentRoute}`,
    );
  } catch {
    return value;
  }
  const documentPath = documentPathFromUrl(resolved);
  if (resolved.pathname.startsWith('/external/')) {
    return staticViewUrl(
      `${resolved.pathname}${resolved.search}${resolved.hash}`,
      basePath,
      entryPath,
    );
  }
  if (
    resolved.origin !== 'http://lat.local' ||
    !documentPath ||
    !documentPaths.has(documentPath)
  ) {
    return value;
  }
  return staticViewUrl(
    `${documentUrl(documentPath)}${resolved.search}${resolved.hash}`,
    basePath,
    entryPath,
  );
}

function rewriteDocumentLinks(
  tree: ViewDocument['tree'],
  basePath: string,
  entryPath: string,
  sourcePath: string | null,
  documentPaths: ReadonlySet<string>,
): ViewDocument['tree'] {
  return rewriteDocumentTreeUrls(tree, (value) =>
    rewriteHtmlLink(value, basePath, entryPath, sourcePath, documentPaths),
  );
}

function rewriteMarkdownReference(
  reference: ViewMarkdownBackReference,
  basePath: string,
  entryPath: string,
  sourcePath: string | null,
  documentPaths: ReadonlySet<string>,
): ViewMarkdownBackReference {
  return {
    ...reference,
    paragraphTree: rewriteDocumentLinks(
      reference.paragraphTree,
      basePath,
      entryPath,
      sourcePath,
      documentPaths,
    ),
    url: staticViewUrl(reference.url, basePath, entryPath),
  };
}

function rewriteBackReference(
  reference: ViewSectionBackReference,
  basePath: string,
  entryPath: string,
  sectionPaths: ReadonlyMap<string, string>,
  documentPaths: ReadonlySet<string>,
): ViewSectionBackReference {
  return reference.kind === 'markdown'
    ? rewriteMarkdownReference(
        reference,
        basePath,
        entryPath,
        sectionPaths.get(reference.sectionId.split('#', 1)[0]) ?? null,
        documentPaths,
      )
    : {
        ...reference,
        url: staticViewUrl(reference.url, basePath, entryPath),
      };
}

function rewriteDocument(
  document: ViewDocument,
  basePath: string,
  entryPath: string,
  sectionPaths: ReadonlyMap<string, string>,
  documentPaths: ReadonlySet<string>,
): ViewDocument {
  return {
    ...document,
    tree: rewriteDocumentLinks(
      document.tree,
      basePath,
      entryPath,
      document.path,
      documentPaths,
    ),
    gitTree: null,
    backReferences: document.backReferences.map((section) => ({
      ...section,
      references: section.references.map((reference) =>
        rewriteBackReference(
          reference,
          basePath,
          entryPath,
          sectionPaths,
          documentPaths,
        ),
      ),
    })),
  };
}

function rewriteSourceReference(
  reference: ViewSourceReference,
  basePath: string,
  entryPath: string,
  sectionPaths: ReadonlyMap<string, string>,
  documentPaths: ReadonlySet<string>,
): ViewSourceReference {
  const sectionPath = reference.sectionId.split('#', 1)[0];
  return {
    ...reference,
    paragraphTree: rewriteDocumentLinks(
      reference.paragraphTree,
      basePath,
      entryPath,
      sectionPaths.get(sectionPath) ?? null,
      documentPaths,
    ),
    url: staticViewUrl(reference.url, basePath, entryPath),
  };
}

function rewriteSource(
  source: ViewSourceDocument,
  basePath: string,
  entryPath: string,
  sectionPaths: ReadonlyMap<string, string>,
  documentPaths: ReadonlySet<string>,
): ViewSourceDocument {
  return {
    ...source,
    context: source.context
      ? rewriteSourceReference(
          source.context,
          basePath,
          entryPath,
          sectionPaths,
          documentPaths,
        )
      : null,
    otherReferences: source.otherReferences.map((reference) =>
      rewriteSourceReference(
        reference,
        basePath,
        entryPath,
        sectionPaths,
        documentPaths,
      ),
    ),
  };
}

function rewriteGraph(
  graph: ViewGraph,
  basePath: string,
  entryPath: string,
): ViewGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(({ gitStatus: _gitStatus, ...node }) => ({
      ...node,
      url: staticViewUrl(node.url, basePath, entryPath),
    })),
  };
}

function positiveInteger(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function sourceRequest(value: string): ViewStaticSourceRequest | null {
  const url = new URL(decodeHtmlUrlAttribute(value), 'http://lat.local');
  if (!url.pathname.startsWith('/code/')) return null;
  let path: string;
  let symbol: string;
  try {
    path = url.pathname
      .slice('/code/'.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
    symbol = decodeURIComponent(url.hash.slice(1));
  } catch {
    return null;
  }
  return {
    path,
    symbol,
    from: url.searchParams.get('from') ?? '',
    line: positiveInteger(url.searchParams.get('line')),
    at: positiveInteger(url.searchParams.get('at')),
  };
}

function externalRequest(
  value: string,
  external?: ExternalResolver,
): string | null {
  let url: URL;
  try {
    url = new URL(decodeHtmlUrlAttribute(value), 'http://lat.local');
  } catch {
    return null;
  }
  if (!url.pathname.startsWith('/external/')) return null;
  try {
    const parts = url.pathname
      .slice('/external/'.length)
      .split('/')
      .map(decodeURIComponent);
    const handle = parts.shift() ?? '';
    const path = parts.join('/');
    if (!handle || !path) return null;
    const fragment = decodeURIComponent(url.hash.slice(1));
    const target = `${handle}:${path}${fragment ? `#${fragment}` : ''}`;
    const parsed = external?.parse(target);
    if (parsed) {
      if (!isDocumentPath(parsed.resolvedPath)) {
        return parsed.identity;
      }
      const hash = parsed.identity.indexOf('#');
      return hash === -1 ? parsed.identity : parsed.identity.slice(0, hash);
    }
    return `${handle}:${path}${isDocumentPath(path) || !fragment ? '' : `#${fragment}`}`;
  } catch {
    return null;
  }
}

function externalRequestsFromDocument(
  document: ViewDocument,
  requests: Set<string>,
  external?: ExternalResolver,
  externalBase?: string,
): void {
  const add = (value: string) => {
    let candidate = value;
    if (externalBase && !value.startsWith('#')) {
      try {
        const colon = externalBase.indexOf(':');
        const base = `/external/${encodeURIComponent(externalBase.slice(0, colon))}/${externalBase
          .slice(colon + 1)
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;
        const resolved = new URL(
          decodeHtmlUrlAttribute(value),
          `http://lat.local${base}`,
        );
        if (resolved.origin === 'http://lat.local') {
          candidate = `${resolved.pathname}${resolved.hash}`;
        }
      } catch {
        // Leave malformed links to the renderer rather than exporting them.
      }
    }
    const request = externalRequest(candidate, external);
    if (request) requests.add(request);
  };
  for (const value of documentTreeUrls(document.tree)) add(value);
  for (const section of document.backReferences) {
    for (const reference of section.references) {
      add(reference.url);
      if (reference.kind === 'markdown') {
        for (const value of documentTreeUrls(reference.paragraphTree))
          add(value);
      }
    }
  }
}

function externalRequestsFromSource(
  source: ViewSourceDocument,
  requests: Set<string>,
  external?: ExternalResolver,
): void {
  for (const reference of [
    ...(source.context ? [source.context] : []),
    ...source.otherReferences,
  ]) {
    for (const value of documentTreeUrls(reference.paragraphTree)) {
      const request = externalRequest(value, external);
      if (request) requests.add(request);
    }
  }
}

function sourceRequestsFromDocument(
  document: ViewDocument,
  requests: Map<string, ViewStaticSourceRequest>,
): void {
  const add = (value: string) => {
    const request = sourceRequest(value);
    if (request) requests.set(viewStaticSourceKey(request), request);
  };
  for (const value of documentTreeUrls(document.tree)) add(value);
  for (const section of document.backReferences) {
    for (const reference of section.references) {
      add(reference.url);
      if (reference.kind === 'markdown') {
        for (const value of documentTreeUrls(reference.paragraphTree))
          add(value);
      }
    }
  }
}

function sourceRequestsFromSource(
  source: ViewSourceDocument,
  requests: Map<string, ViewStaticSourceRequest>,
): void {
  const references = [
    ...(source.context ? [source.context] : []),
    ...source.otherReferences,
  ];
  for (const reference of references) {
    for (const value of documentTreeUrls(reference.paragraphTree)) {
      const request = sourceRequest(value);
      if (request) requests.set(viewStaticSourceKey(request), request);
    }
  }
}

type ViewStaticDataKind =
  | 'documents'
  | 'graphs'
  | 'source-files'
  | 'source-views'
  | 'external-documents'
  | 'external-source-files'
  | 'external-source-views';

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function dataFile(kind: ViewStaticDataKind, content: string): string {
  const digest = createHash('sha256')
    .update(content)
    .digest('hex')
    .slice(0, 20);
  return `data/${kind}/${digest}.json`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeJson(value));
}

async function writeDataJson(
  outputDir: string,
  kind: ViewStaticDataKind,
  value: unknown,
): Promise<string> {
  const content = serializeJson(value);
  const path = dataFile(kind, content);
  await mkdir(dirname(join(outputDir, path)), { recursive: true });
  await writeFile(join(outputDir, path), content);
  return path;
}

async function outputExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Refuse build targets that exist or could replace the project itself. */
export async function validateViewBuildOutput(
  outputDir: string,
  projectRoot: string,
  kind = 'Static',
  force = false,
): Promise<void> {
  if (
    outputDir === parse(outputDir).root ||
    outputDir === projectRoot ||
    isInside(outputDir, projectRoot)
  ) {
    throw new Error(`${kind} UI output must not contain the project root`);
  }
  if (!force && (await outputExists(outputDir))) {
    throw new Error(
      `${kind} UI output already exists: ${outputDir}. Use --force to replace it.`,
    );
  }
}

type ViewBuildMoveDependencies = {
  move: typeof rename;
  wait: (milliseconds: number) => Promise<void>;
};

const defaultViewBuildMoveDependencies: ViewBuildMoveDependencies = {
  move: rename,
  wait: (milliseconds) =>
    new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
};

/** Commit a staged build after transient filesystem locks have cleared. */
export async function moveViewBuildOutput(
  stagingDir: string,
  outputDir: string,
  dependencies: ViewBuildMoveDependencies = defaultViewBuildMoveDependencies,
): Promise<void> {
  for (let retries = 0; ; retries += 1) {
    try {
      await dependencies.move(stagingDir, outputDir);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        retries >= VIEW_BUILD_MOVE_MAX_RETRIES ||
        (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY')
      ) {
        throw error;
      }
      await dependencies.wait(VIEW_BUILD_MOVE_RETRY_DELAY_MS);
    }
  }
}

/** Remove abandoned staging after transient filesystem locks have cleared. */
export async function removeViewBuildStaging(
  stagingDir: string,
): Promise<void> {
  await rm(stagingDir, {
    recursive: true,
    force: true,
    maxRetries: VIEW_BUILD_MOVE_MAX_RETRIES,
    retryDelay: VIEW_BUILD_MOVE_RETRY_DELAY_MS,
  });
}

function sectionDocumentPaths(
  documents: ReadonlyMap<string, ViewDocument>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const path of documents.keys()) {
    result.set(`lat.md/${path.slice(0, -'.md'.length)}`, path);
  }
  return result;
}

function clientShell(
  html: string,
  basePath: string,
  entry: string,
  searchApi?: string,
): string {
  const assets = rewriteClientAssetUrls(html, basePath);
  const configValue = encodeURIComponent(
    JSON.stringify({ basePath, entry, searchApi }),
  );
  const config = `<meta name="lat-static-view" content="${configValue}">`;
  return assets.includes('</head>')
    ? assets.replace('</head>', `  ${config}\n  </head>`)
    : `${config}\n${assets}`;
}

function bootstrapShell(
  shell: string,
  manifest: ViewStaticManifest,
  responses: Record<string, object> = {},
): string {
  const bootstrap: ViewStaticBootstrap = { manifest, responses };
  const value = JSON.stringify(bootstrap).replaceAll('<', '\\u003c');
  const data = `<script id="${VIEW_STATIC_BOOTSTRAP_ID}" type="application/json">${value}</script>`;
  return shell.includes('</head>')
    ? shell.replace('</head>', `  ${data}\n  </head>`)
    : `${data}\n${shell}`;
}

const REDIRECT_SCRIPT_PATH = 'data/redirect.js';
const REDIRECT_SCRIPT = `const meta = document.querySelector('meta[name="lat-redirect"]');
if (meta) {
  try {
    window.location.replace(decodeURIComponent(meta.content) + window.location.search + window.location.hash);
  } catch {}
}
`;

function redirectShell(target: string, basePath: string): string {
  const escaped = target.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const scriptUrl = `${basePath}${REDIRECT_SCRIPT_PATH}`
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="lat-redirect" content="${encodeURIComponent(target)}" />
    <title>lat.md</title>
    <script src="${scriptUrl}" defer></script>
  </head>
  <body><a href="${escaped}">Open lat.md</a></body>
</html>
`;
}

async function writeRouteShell(
  outputDir: string,
  route: string,
  shell: string,
): Promise<void> {
  const path = join(outputDir, ...route.split('/'), 'index.html');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, shell);
}

/** Build a serverless snapshot of the current read-only Lat UI. */
export async function buildStaticView(
  ctx: CmdContext,
  requestedOutput: string,
  options: StaticViewBuildOptions = {},
): Promise<StaticViewBuildResult> {
  const outputDir = resolve(ctx.projectRoot, requestedOutput);
  const basePath = normalizeStaticViewBasePath(options.basePath ?? '/');
  const clientDir = options.clientDir ?? defaultClientDir;
  const logoText = options.logoText ?? DEFAULT_VIEW_LOGO_TEXT;
  await validateViewBuildOutput(
    outputDir,
    ctx.projectRoot,
    'Static',
    options.force,
  );

  await mkdir(dirname(outputDir), { recursive: true });
  const stagingDir = await mkdtemp(
    join(dirname(outputDir), '.lat-static-staging-'),
  );
  const store = await createViewStore(ctx.latDir, ctx.projectRoot, {
    codeExcludePaths: [outputDir, ...(options.codeExcludePaths ?? [])],
    git: false,
    watch: false,
    externalIgnoreLocal: true,
    externalCa: options.externalCa,
  });

  try {
    const clientHtml = await readFile(join(clientDir, 'index.html'), 'utf8');
    const payloadDir = staticViewPayloadDir(stagingDir, basePath);
    await mkdir(payloadDir, { recursive: true });
    await cp(clientDir, payloadDir, { recursive: true });
    const index = { ...store.getIndex(), git: null, logoText };
    validateDocumentRoutes(index.files);
    const shell = clientShell(
      clientHtml,
      basePath,
      index.entry,
      options.searchApi,
    );
    const documents = new Map<string, ViewDocument>();
    const documentResources = new Set<string>();
    const sourceRequests = new Map<string, ViewStaticSourceRequest>();
    const externalRequests = new Set<string>();

    for (const file of index.externalFiles) {
      externalRequests.add(file.target);
    }

    for (const path of index.files) {
      const document = await store.getDocument(path);
      documents.set(path, document);
      for (const url of documentTreeUrls(document.tree)) {
        let parsed: URL;
        try {
          parsed = new URL(url, 'http://lat.local');
        } catch {
          continue;
        }
        if (parsed.origin !== 'http://lat.local') continue;
        const resourcePath = documentResourcePath(parsed.pathname);
        if (resourcePath) documentResources.add(resourcePath);
      }
      sourceRequestsFromDocument(document, sourceRequests);
      externalRequestsFromDocument(
        document,
        externalRequests,
        store.snapshot.external,
      );
    }
    const documentPaths = new Set(documents.keys());
    const sectionPaths = sectionDocumentPaths(documents);

    const graph = store.getGraph();
    for (const node of graph.nodes) {
      const request = sourceRequest(node.url);
      if (request) sourceRequests.set(viewStaticSourceKey(request), request);
      if (node.externalTarget) externalRequests.add(node.externalTarget);
    }

    const externals = new Map<string, ViewExternalDocument>();
    const pendingExternal = [...externalRequests];
    for (let index = 0; index < pendingExternal.length; index++) {
      const target = pendingExternal[index];
      if (externals.has(target)) continue;
      let external: ViewExternalDocument;
      try {
        external = await store.getExternal(target);
      } catch (error) {
        throw new Error(
          `Could not export external source ${target}: ${(error as Error).message}`,
        );
      }
      externals.set(target, external);
      const before = externalRequests.size;
      if (external.kind === 'markdown') {
        sourceRequestsFromDocument(external.document, sourceRequests);
        externalRequestsFromDocument(
          external.document,
          externalRequests,
          store.snapshot.external,
          external.document.path,
        );
      } else {
        sourceRequestsFromSource(external.source, sourceRequests);
        externalRequestsFromSource(
          external.source,
          externalRequests,
          store.snapshot.external,
        );
      }
      if (externalRequests.size > before) {
        for (const next of externalRequests) {
          if (!externals.has(next) && !pendingExternal.includes(next)) {
            pendingExternal.push(next);
          }
        }
      }
    }

    const sources = new Map<string, ViewSourceDocument>();
    const pending = [...sourceRequests.keys()];
    for (let index = 0; index < pending.length; index++) {
      const key = pending[index];
      if (sources.has(key)) continue;
      const request = sourceRequests.get(key)!;
      const origin =
        request.from && request.line > 0
          ? { sectionId: request.from, line: request.line }
          : undefined;
      let source: ViewSourceDocument;
      try {
        source = await store.getSource(
          request.path,
          request.symbol,
          origin,
          request.at,
        );
      } catch (error) {
        const target = `${request.path}${request.symbol ? `#${request.symbol}` : ''}`;
        throw new Error(
          `Could not export source ${target}: ${(error as Error).message}`,
        );
      }
      sources.set(key, source);
      const before = sourceRequests.size;
      sourceRequestsFromSource(source, sourceRequests);
      if (sourceRequests.size > before) {
        for (const next of sourceRequests.keys()) {
          if (!sources.has(next) && !pending.includes(next)) pending.push(next);
        }
      }
    }

    const rewrittenGraph = rewriteGraph(graph, basePath, index.entry);
    const manifest: ViewStaticManifest = {
      version: 1,
      index,
      graph: await writeDataJson(payloadDir, 'graphs', rewrittenGraph),
      documents: {},
      sources: {},
      externals: {},
    };
    const documentBootstraps = new Map<
      string,
      { request: string; document: ViewDocument }
    >();

    for (const [path, document] of documents) {
      const rewritten = rewriteDocument(
        document,
        basePath,
        index.entry,
        sectionPaths,
        documentPaths,
      );
      manifest.documents[path] = await writeDataJson(
        payloadDir,
        'documents',
        rewritten,
      );
      const source = await store.getDocumentSource(path);
      const rawPath = join(payloadDir, ...path.split('/'));
      await mkdir(dirname(rawPath), { recursive: true });
      await writeFile(rawPath, source.content);
      const route = path.slice(0, -'.md'.length);
      documentBootstraps.set(route, {
        request: viewStaticDocumentRequest(path),
        document: rewritten,
      });
    }

    for (const path of [...documentResources].sort()) {
      let content: Buffer;
      try {
        content = await store.getDocumentResource(path);
      } catch (error) {
        throw new Error(
          `Could not export document resource ${path}: ${(error as Error).message}`,
        );
      }
      const outputPath = join(payloadDir, 'resources', ...path.split('/'));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content);
    }

    const sourceFiles = new Map<string, string>();
    for (const [key, source] of sources) {
      const rewritten = rewriteSource(
        source,
        basePath,
        index.entry,
        sectionPaths,
        documentPaths,
      );
      const { path, content, highlightedLines, ...view } = rewritten;
      let fileDataPath = sourceFiles.get(path);
      if (!fileDataPath) {
        fileDataPath = await writeDataJson(payloadDir, 'source-files', {
          path,
          content,
          highlightedLines,
        });
        sourceFiles.set(path, fileDataPath);
      }
      const viewDataPath = await writeDataJson(
        payloadDir,
        'source-views',
        view,
      );
      manifest.sources[key] = { file: fileDataPath, view: viewDataPath };
    }

    const externalSourceFiles = new Map<string, string>();
    const externalRoutes = new Set<string>();
    for (const [target, external] of externals) {
      if (external.kind === 'markdown') {
        const dataPath = await writeDataJson(payloadDir, 'external-documents', {
          ...external,
          document: rewriteDocument(
            external.document,
            basePath,
            index.entry,
            sectionPaths,
            documentPaths,
          ),
        } satisfies ViewExternalDocument);
        manifest.externals[target] = { kind: 'markdown', document: dataPath };
        const colon = external.document.path.indexOf(':');
        externalRoutes.add(
          `external/${external.document.path.slice(0, colon)}/${external.document.path.slice(colon + 1)}`,
        );
        continue;
      }

      const rewritten = rewriteSource(
        external.source,
        basePath,
        index.entry,
        sectionPaths,
        documentPaths,
      );
      const { path, content, highlightedLines, ...sourceView } = rewritten;
      let fileDataPath = externalSourceFiles.get(path);
      if (!fileDataPath) {
        fileDataPath = await writeDataJson(
          payloadDir,
          'external-source-files',
          {
            path,
            content,
            highlightedLines,
          },
        );
        externalSourceFiles.set(path, fileDataPath);
      }
      const view: ViewStaticExternalSourceView = {
        kind: 'source',
        target: external.target,
        source: sourceView,
      };
      const viewDataPath = await writeDataJson(
        payloadDir,
        'external-source-views',
        view,
      );
      manifest.externals[target] = {
        kind: 'source',
        file: fileDataPath,
        view: viewDataPath,
      };
      const colon = path.indexOf(':');
      externalRoutes.add(
        `external/${path.slice(0, colon)}/${path.slice(colon + 1)}`,
      );
    }
    await writeJson(join(payloadDir, 'data/manifest.json'), manifest);
    const entryRoute = index.entry.slice(0, -'.md'.length);
    const entryBootstrap = documentBootstraps.get(entryRoute);
    if (!entryBootstrap) {
      throw new Error(`Static UI entry document is missing: ${index.entry}`);
    }
    for (const [route, initial] of documentBootstraps) {
      if (route === entryRoute) continue;
      await writeRouteShell(
        payloadDir,
        route,
        bootstrapShell(shell, manifest, {
          [initial.request]: initial.document,
        }),
      );
    }
    const genericShell = bootstrapShell(shell, manifest);
    for (const path of sourceFiles.keys()) {
      await writeRouteShell(payloadDir, `code/${path}`, genericShell);
    }
    for (const route of externalRoutes) {
      await writeRouteShell(payloadDir, route, genericShell);
    }
    await writeRouteShell(
      payloadDir,
      'graph',
      bootstrapShell(shell, manifest, { '/api/graph': rewrittenGraph }),
    );
    if (options.searchApi) {
      await writeRouteShell(payloadDir, 'search', genericShell);
    }
    const redirectScriptPath = join(payloadDir, REDIRECT_SCRIPT_PATH);
    await mkdir(dirname(redirectScriptPath), { recursive: true });
    await writeFile(redirectScriptPath, REDIRECT_SCRIPT);
    await writeFile(
      join(payloadDir, 'index.html'),
      bootstrapShell(shell, manifest, {
        [entryBootstrap.request]: entryBootstrap.document,
      }),
    );
    await writeRouteShell(
      payloadDir,
      entryRoute,
      redirectShell(basePath, basePath),
    );
    if (payloadDir !== stagingDir) {
      await writeFile(
        join(stagingDir, 'index.html'),
        redirectShell(basePath, basePath),
      );
    }
    if (options.force) {
      await rm(outputDir, { recursive: true, force: true });
    }
    await moveViewBuildOutput(stagingDir, outputDir);
    return {
      documents: documents.size,
      outputDir,
      sources: sources.size + externals.size,
    };
  } catch (error) {
    await removeViewBuildStaging(stagingDir);
    throw error;
  } finally {
    await store.close();
  }
}
