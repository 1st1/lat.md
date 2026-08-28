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
import {
  viewStaticSourceKey,
  type ViewStaticExternalSourceView,
  type ViewStaticManifest,
  type ViewStaticSourceRequest,
} from './static-protocol.js';
import { createViewStore } from './store.js';

const BUILD_MARKER = '.lat-ui-build';
const defaultClientDir = fileURLToPath(new URL('./client/', import.meta.url));

export type StaticViewBuildOptions = {
  basePath?: string;
  clientDir?: string;
  logoText?: string;
  externalCa?: string | Buffer;
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
  const parsed = new URL(value || '/', 'http://lat.local');
  if (
    parsed.origin !== 'http://lat.local' ||
    parsed.search ||
    parsed.hash ||
    !value.startsWith('/')
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
export function staticViewUrl(value: string, basePath: string): string {
  if (!value || value.startsWith('#')) return value;
  let url: URL;
  try {
    url = new URL(decodeHtmlUrlAttribute(value), 'http://lat.local');
  } catch {
    return value;
  }
  if (url.origin !== 'http://lat.local') return value;

  for (const prefix of ['/docs/', '/code/', '/external/'] as const) {
    if (!url.pathname.startsWith(prefix)) continue;
    const route = url.pathname.slice(1).replace(/\/+$/, '');
    return `${basePath}${route}/${url.search}${url.hash}`;
  }
  if (url.pathname === '/graph') {
    return `${basePath}graph/${url.search}${url.hash}`;
  }
  return value;
}

function documentPathFromUrl(value: URL): string | null {
  if (!value.pathname.startsWith('/docs/')) return null;
  try {
    return value.pathname
      .slice('/docs/'.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
  } catch {
    return null;
  }
}

function rewriteHtmlLink(
  value: string,
  basePath: string,
  sourcePath: string | null,
  documentPaths: ReadonlySet<string>,
): string {
  const direct = staticViewUrl(value, basePath);
  if (direct !== value || !sourcePath || value.startsWith('#')) return direct;

  let resolved: URL;
  try {
    const externalAt = sourcePath.indexOf(':');
    const currentPath = sourcePath.split('/').map(encodeURIComponent).join('/');
    const currentRoute =
      externalAt > 0 && !documentPaths.has(sourcePath)
        ? `/external/${encodeURIComponent(sourcePath.slice(0, externalAt))}/${sourcePath
            .slice(externalAt + 1)
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`
        : `/docs/${currentPath}`;
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
    `${resolved.pathname}${resolved.search}${resolved.hash}`,
    basePath,
  );
}

function rewriteHtmlLinks(
  html: string,
  basePath: string,
  sourcePath: string | null,
  documentPaths: ReadonlySet<string>,
): string {
  return html.replace(/href="([^"]*)"/g, (attribute, value: string) => {
    const rewritten = rewriteHtmlLink(
      value,
      basePath,
      sourcePath,
      documentPaths,
    );
    if (rewritten === value) return attribute;
    return `href="${rewritten.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`;
  });
}

function rewriteMarkdownReference(
  reference: ViewMarkdownBackReference,
  basePath: string,
  sourcePath: string | null,
  documentPaths: ReadonlySet<string>,
): ViewMarkdownBackReference {
  return {
    ...reference,
    paragraphHtml: rewriteHtmlLinks(
      reference.paragraphHtml,
      basePath,
      sourcePath,
      documentPaths,
    ),
    url: staticViewUrl(reference.url, basePath),
  };
}

function rewriteBackReference(
  reference: ViewSectionBackReference,
  basePath: string,
  sectionPaths: ReadonlyMap<string, string>,
  documentPaths: ReadonlySet<string>,
): ViewSectionBackReference {
  return reference.kind === 'markdown'
    ? rewriteMarkdownReference(
        reference,
        basePath,
        sectionPaths.get(reference.sectionId.split('#', 1)[0]) ?? null,
        documentPaths,
      )
    : { ...reference, url: staticViewUrl(reference.url, basePath) };
}

function rewriteDocument(
  document: ViewDocument,
  basePath: string,
  sectionPaths: ReadonlyMap<string, string>,
  documentPaths: ReadonlySet<string>,
): ViewDocument {
  return {
    ...document,
    html: rewriteHtmlLinks(
      document.html,
      basePath,
      document.path,
      documentPaths,
    ),
    gitHtml: null,
    backReferences: document.backReferences.map((section) => ({
      ...section,
      references: section.references.map((reference) =>
        rewriteBackReference(reference, basePath, sectionPaths, documentPaths),
      ),
    })),
  };
}

function rewriteSourceReference(
  reference: ViewSourceReference,
  basePath: string,
  sectionPaths: ReadonlyMap<string, string>,
  documentPaths: ReadonlySet<string>,
): ViewSourceReference {
  const sectionPath = reference.sectionId.split('#', 1)[0];
  return {
    ...reference,
    paragraphHtml: rewriteHtmlLinks(
      reference.paragraphHtml,
      basePath,
      sectionPaths.get(sectionPath) ?? null,
      documentPaths,
    ),
    url: staticViewUrl(reference.url, basePath),
  };
}

function rewriteSource(
  source: ViewSourceDocument,
  basePath: string,
  sectionPaths: ReadonlyMap<string, string>,
  documentPaths: ReadonlySet<string>,
): ViewSourceDocument {
  return {
    ...source,
    context: source.context
      ? rewriteSourceReference(
          source.context,
          basePath,
          sectionPaths,
          documentPaths,
        )
      : null,
    otherReferences: source.otherReferences.map((reference) =>
      rewriteSourceReference(reference, basePath, sectionPaths, documentPaths),
    ),
  };
}

function rewriteGraph(graph: ViewGraph, basePath: string): ViewGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(({ gitStatus: _gitStatus, ...node }) => ({
      ...node,
      url: staticViewUrl(node.url, basePath),
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

function externalRequest(value: string): string | null {
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
    return `${handle}:${path}${path.toLowerCase().endsWith('.md') || !fragment ? '' : `#${fragment}`}`;
  } catch {
    return null;
  }
}

function externalRequestsFromDocument(
  document: ViewDocument,
  requests: Set<string>,
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
    const request = externalRequest(candidate);
    if (request) requests.add(request);
  };
  for (const match of document.html.matchAll(/href="([^"]*)"/g)) add(match[1]);
  for (const section of document.backReferences) {
    for (const reference of section.references) {
      add(reference.url);
      if (reference.kind === 'markdown') {
        for (const match of reference.paragraphHtml.matchAll(
          /href="([^"]*)"/g,
        )) {
          add(match[1]);
        }
      }
    }
  }
}

function externalRequestsFromSource(
  source: ViewSourceDocument,
  requests: Set<string>,
): void {
  for (const reference of [
    ...(source.context ? [source.context] : []),
    ...source.otherReferences,
  ]) {
    for (const match of reference.paragraphHtml.matchAll(/href="([^"]*)"/g)) {
      const request = externalRequest(match[1]);
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
  for (const match of document.html.matchAll(/href="([^"]*)"/g)) add(match[1]);
  for (const section of document.backReferences) {
    for (const reference of section.references) {
      add(reference.url);
      if (reference.kind === 'markdown') {
        for (const match of reference.paragraphHtml.matchAll(
          /href="([^"]*)"/g,
        )) {
          add(match[1]);
        }
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
    for (const match of reference.paragraphHtml.matchAll(/href="([^"]*)"/g)) {
      const request = sourceRequest(match[1]);
      if (request) requests.set(viewStaticSourceKey(request), request);
    }
  }
}

function dataFile(
  kind:
    | 'documents'
    | 'source-files'
    | 'source-views'
    | 'external-documents'
    | 'external-source-files'
    | 'external-source-views',
  key: string,
): string {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 20);
  return `data/${kind}/${digest}.json`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`);
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

async function validateOutput(outputDir: string, projectRoot: string) {
  if (
    outputDir === parse(outputDir).root ||
    outputDir === projectRoot ||
    isInside(outputDir, projectRoot)
  ) {
    throw new Error('Static UI output must not contain the project root');
  }
  if (await outputExists(outputDir)) {
    throw new Error(`Static UI output already exists: ${outputDir}`);
  }
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

function clientShell(html: string, basePath: string): string {
  const assets = html.replace(
    /(["'])\/assets\//g,
    (_match, quote: string) => `${quote}${basePath}assets/`,
  );
  const configValue = JSON.stringify({ basePath }).replaceAll('<', '\\u003c');
  const config = `<script>globalThis.__LAT_STATIC_VIEW__=${configValue}</script>`;
  return assets.includes('</head>')
    ? assets.replace('</head>', `  ${config}\n  </head>`)
    : `${config}\n${assets}`;
}

function redirectShell(target: string): string {
  const escaped = target.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const scriptTarget = JSON.stringify(target).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0;url=${escaped}" />
    <title>lat.md</title>
  </head>
  <body><script>window.location.replace(${scriptTarget} + window.location.hash)</script></body>
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
  await validateOutput(outputDir, ctx.projectRoot);

  await mkdir(dirname(outputDir), { recursive: true });
  const stagingDir = await mkdtemp(join(dirname(outputDir), '.lat-ui-build-'));
  const store = await createViewStore(ctx.latDir, ctx.projectRoot, {
    codeExcludePaths: [outputDir],
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
    const shell = clientShell(clientHtml, basePath);
    const index = { ...store.getIndex(), git: null, logoText };
    const documents = new Map<string, ViewDocument>();
    const sourceRequests = new Map<string, ViewStaticSourceRequest>();
    const externalRequests = new Set<string>();

    for (const path of index.files) {
      const document = await store.getDocument(path);
      documents.set(path, document);
      sourceRequestsFromDocument(document, sourceRequests);
      externalRequestsFromDocument(document, externalRequests);
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
          external.document.path,
        );
      } else {
        sourceRequestsFromSource(external.source, sourceRequests);
        externalRequestsFromSource(external.source, externalRequests);
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

    const manifest: ViewStaticManifest = {
      version: 1,
      index,
      graph: 'data/graph.json',
      documents: {},
      sources: {},
      externals: {},
    };
    await writeJson(
      join(payloadDir, manifest.graph),
      rewriteGraph(graph, basePath),
    );

    for (const [path, document] of documents) {
      const dataPath = dataFile('documents', path);
      manifest.documents[path] = dataPath;
      await writeJson(
        join(payloadDir, dataPath),
        rewriteDocument(document, basePath, sectionPaths, documentPaths),
      );
      const route = `docs/${path}`;
      await writeRouteShell(payloadDir, route, shell);
    }

    const sourceFiles = new Map<string, string>();
    for (const [key, source] of sources) {
      const rewritten = rewriteSource(
        source,
        basePath,
        sectionPaths,
        documentPaths,
      );
      const { path, content, highlightedHtmlLines, ...view } = rewritten;
      let fileDataPath = sourceFiles.get(path);
      if (!fileDataPath) {
        fileDataPath = dataFile('source-files', path);
        sourceFiles.set(path, fileDataPath);
        await writeJson(join(payloadDir, fileDataPath), {
          path,
          content,
          highlightedHtmlLines,
        });
      }
      const viewDataPath = dataFile('source-views', key);
      manifest.sources[key] = { file: fileDataPath, view: viewDataPath };
      await writeJson(join(payloadDir, viewDataPath), view);
    }
    for (const path of sourceFiles.keys()) {
      const route = `code/${path}`;
      await writeRouteShell(payloadDir, route, shell);
    }

    const externalSourceFiles = new Map<string, string>();
    const externalRoutes = new Set<string>();
    for (const [target, external] of externals) {
      if (external.kind === 'markdown') {
        const dataPath = dataFile('external-documents', target);
        manifest.externals[target] = { kind: 'markdown', document: dataPath };
        await writeJson(join(payloadDir, dataPath), {
          ...external,
          document: rewriteDocument(
            external.document,
            basePath,
            sectionPaths,
            documentPaths,
          ),
        } satisfies ViewExternalDocument);
        const colon = external.document.path.indexOf(':');
        externalRoutes.add(
          `external/${external.document.path.slice(0, colon)}/${external.document.path.slice(colon + 1)}`,
        );
        continue;
      }

      const rewritten = rewriteSource(
        external.source,
        basePath,
        sectionPaths,
        documentPaths,
      );
      const { path, content, highlightedHtmlLines, ...sourceView } = rewritten;
      let fileDataPath = externalSourceFiles.get(path);
      if (!fileDataPath) {
        fileDataPath = dataFile('external-source-files', path);
        externalSourceFiles.set(path, fileDataPath);
        await writeJson(join(payloadDir, fileDataPath), {
          path,
          content,
          highlightedHtmlLines,
        });
      }
      const viewDataPath = dataFile('external-source-views', target);
      manifest.externals[target] = {
        kind: 'source',
        file: fileDataPath,
        view: viewDataPath,
      };
      const view: ViewStaticExternalSourceView = {
        kind: 'source',
        target: external.target,
        source: sourceView,
      };
      await writeJson(join(payloadDir, viewDataPath), view);
      const colon = path.indexOf(':');
      externalRoutes.add(
        `external/${path.slice(0, colon)}/${path.slice(colon + 1)}`,
      );
    }
    for (const route of externalRoutes) {
      await writeRouteShell(payloadDir, route, shell);
    }
    await writeRouteShell(payloadDir, 'graph', shell);
    await writeJson(join(payloadDir, 'data/manifest.json'), manifest);
    const entryRedirect = redirectShell(
      staticViewUrl(`/docs/${index.entry}`, basePath),
    );
    await writeFile(join(payloadDir, 'index.html'), entryRedirect);
    if (payloadDir !== stagingDir) {
      await writeFile(join(stagingDir, 'index.html'), entryRedirect);
    }
    await writeFile(
      join(stagingDir, BUILD_MARKER),
      `${JSON.stringify({ version: 1 })}\n`,
    );

    await rename(stagingDir, outputDir);
    return {
      documents: documents.size,
      outputDir,
      sources: sources.size + externals.size,
    };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  } finally {
    await store.close();
  }
}
