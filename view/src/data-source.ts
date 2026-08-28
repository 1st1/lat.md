import type {
  ViewError,
  ViewExternalDocument,
  ViewSourceDocument,
} from '../../src/view/protocol';
import {
  viewStaticSourceKey,
  type ViewStaticManifest,
  type ViewStaticSourceFile,
  type ViewStaticSourceRequest,
  type ViewStaticSourceView,
  type ViewStaticExternalMarkdown,
  type ViewStaticExternalSourceView,
} from '../../src/view/static-protocol';
import { staticViewBasePath } from './static-mode';

let manifestRequest: Promise<ViewStaticManifest> | null = null;

async function fetchJsonFile<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const value = (await response.json()) as T | ViewError;
  if (!response.ok) {
    throw new Error(
      value && typeof value === 'object' && 'error' in value
        ? value.error
        : 'Request failed',
    );
  }
  return value as T;
}

function staticDataUrl(path: string): string {
  const basePath = staticViewBasePath();
  if (!basePath) return path;
  return new URL(`${basePath}${path}`, window.location.origin).toString();
}

function staticManifest(): Promise<ViewStaticManifest> {
  if (!manifestRequest) {
    manifestRequest = fetchJsonFile<ViewStaticManifest>(
      staticDataUrl('data/manifest.json'),
    ).catch((error) => {
      manifestRequest = null;
      throw error;
    });
  }
  return manifestRequest;
}

function positiveInteger(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** Resolve either a live API request or its immutable static-build equivalent. */
export async function fetchViewJson<T extends object>(
  requestUrl: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!staticViewBasePath()) {
    return fetchJsonFile<T>(requestUrl, signal);
  }

  const manifest = await staticManifest();
  const url = new URL(requestUrl, 'http://lat.local');
  if (url.pathname === '/api/index') return manifest.index as T;

  let dataPath: string | undefined;
  if (url.pathname === '/api/graph') {
    dataPath = manifest.graph;
  } else if (url.pathname === '/api/document') {
    dataPath = manifest.documents[url.searchParams.get('path') ?? ''];
  } else if (url.pathname === '/api/source') {
    const request: ViewStaticSourceRequest = {
      path: url.searchParams.get('path') ?? '',
      symbol: url.searchParams.get('symbol') ?? '',
      from: url.searchParams.get('from') ?? '',
      line: positiveInteger(url.searchParams.get('line')),
      at: positiveInteger(url.searchParams.get('at')),
    };
    const entry = manifest.sources[viewStaticSourceKey(request)];
    if (!entry) throw new Error('Static view data not found');
    const [file, view] = await Promise.all([
      fetchJsonFile<ViewStaticSourceFile>(staticDataUrl(entry.file), signal),
      fetchJsonFile<ViewStaticSourceView>(staticDataUrl(entry.view), signal),
    ]);
    return { ...file, ...view } as ViewSourceDocument as T;
  } else if (url.pathname === '/api/external') {
    const entry = manifest.externals[url.searchParams.get('target') ?? ''];
    if (!entry) throw new Error('Static external data not found');
    if (entry.kind === 'markdown') {
      const document = await fetchJsonFile<ViewStaticExternalMarkdown>(
        staticDataUrl(entry.document),
        signal,
      );
      return document as T;
    }
    const [file, view] = await Promise.all([
      fetchJsonFile<ViewStaticSourceFile>(staticDataUrl(entry.file), signal),
      fetchJsonFile<ViewStaticExternalSourceView>(
        staticDataUrl(entry.view),
        signal,
      ),
    ]);
    return {
      ...view,
      source: { ...file, ...view.source },
    } as ViewExternalDocument as T;
  }
  if (!dataPath) throw new Error('Static view data not found');
  return fetchJsonFile<T>(staticDataUrl(dataPath), signal);
}
