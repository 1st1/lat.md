import type {
  ViewDocumentEditRequest,
  ViewDocumentEditResponse,
  ViewDocumentSource,
  ViewError,
  ViewExternalDocument,
  ViewSourceDocument,
} from '../../src/view/protocol';
import {
  viewStaticSourceKey,
  viewStaticDocumentRequest,
  VIEW_STATIC_BOOTSTRAP_ID,
  type ViewStaticBootstrap,
  type ViewStaticManifest,
  type ViewStaticSourceFile,
  type ViewStaticSourceRequest,
  type ViewStaticSourceView,
  type ViewStaticExternalMarkdown,
  type ViewStaticExternalSourceView,
} from '../../src/view/static-protocol';
import { staticViewBasePath, staticViewSearchApi } from './static-mode';

let manifestRequest: Promise<ViewStaticManifest> | null = null;
let bootstrap: ViewStaticBootstrap | null | undefined;
const staticFileRequests = new Map<string, Promise<object>>();

export const VIEW_REQUEST_TIMEOUT_MS = 15_000;

export class ViewRequestTimeoutError extends Error {
  override name = 'TimeoutError';
}

export class ViewRequestConnectionError extends Error {
  override name = 'NetworkError';
}

function isTransientRequestError(reason: unknown): boolean {
  return (
    reason instanceof TypeError ||
    (typeof reason === 'object' &&
      reason !== null &&
      'name' in reason &&
      reason.name === 'AbortError')
  );
}

async function fetchJsonFile<T>(
  url: string,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, VIEW_REQUEST_TIMEOUT_MS);
  const method = (init.method ?? 'GET').toUpperCase();
  const attempts = method === 'GET' || method === 'HEAD' ? 2 : 1;
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        const value = (await response.json()) as T | ViewError;
        if (!response.ok) {
          throw new Error(
            value && typeof value === 'object' && 'error' in value
              ? value.error
              : 'Request failed',
          );
        }
        return value as T;
      } catch (reason) {
        if (timedOut) {
          throw new ViewRequestTimeoutError(
            'The server did not respond in time. Try again.',
          );
        }
        if (controller.signal.aborted) throw reason;
        if (!isTransientRequestError(reason)) throw reason;
        if (attempt + 1 < attempts) continue;
        throw new ViewRequestConnectionError(
          'The server connection was interrupted. Try again.',
        );
      }
    }
    throw new ViewRequestConnectionError(
      'The server connection was interrupted. Try again.',
    );
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function fetchViewDocumentSource(
  path: string,
  signal?: AbortSignal,
): Promise<ViewDocumentSource> {
  if (staticViewBasePath()) {
    return Promise.reject(new Error('Static views cannot edit documents'));
  }
  return fetchJsonFile<ViewDocumentSource>(
    `/api/document-source?path=${encodeURIComponent(path)}`,
    signal,
  );
}

export function updateViewDocument(
  path: string,
  edit: ViewDocumentEditRequest,
  signal?: AbortSignal,
): Promise<ViewDocumentEditResponse> {
  if (staticViewBasePath()) {
    return Promise.reject(new Error('Static views cannot edit documents'));
  }
  return fetchJsonFile<ViewDocumentEditResponse>(
    `/api/document?path=${encodeURIComponent(path)}`,
    signal,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    },
  );
}

function staticDataUrl(path: string): string {
  const basePath = staticViewBasePath();
  if (!basePath) return path;
  return new URL(`${basePath}${path}`, window.location.origin).toString();
}

function fetchStaticFile<T extends object>(path: string): Promise<T> {
  const url = staticDataUrl(path);
  const existing = staticFileRequests.get(url);
  if (existing) return existing as Promise<T>;
  const request = fetchJsonFile<T>(url).catch((error) => {
    staticFileRequests.delete(url);
    throw error;
  });
  staticFileRequests.set(url, request);
  return request;
}

function staticBootstrap(): ViewStaticBootstrap | null {
  if (bootstrap !== undefined) return bootstrap;
  const content = document.getElementById(
    VIEW_STATIC_BOOTSTRAP_ID,
  )?.textContent;
  if (!content) return (bootstrap = null);
  try {
    const value = JSON.parse(content) as ViewStaticBootstrap;
    if (
      !value ||
      typeof value !== 'object' ||
      !value.manifest ||
      typeof value.responses !== 'object'
    ) {
      return (bootstrap = null);
    }
    return (bootstrap = value);
  } catch {
    return (bootstrap = null);
  }
}

function staticManifest(): Promise<ViewStaticManifest> {
  const initial = staticBootstrap()?.manifest;
  if (initial) return Promise.resolve(initial);
  if (!manifestRequest) {
    manifestRequest = fetchStaticFile<ViewStaticManifest>(
      'data/manifest.json',
    ).catch((error) => {
      manifestRequest = null;
      throw error;
    });
  }
  return manifestRequest;
}

/** Warm a content-addressed document when a static navigation is imminent. */
export async function prefetchViewDocument(path: string): Promise<void> {
  if (!staticViewBasePath()) return;
  if (staticBootstrap()?.responses[viewStaticDocumentRequest(path)]) return;
  const manifest = await staticManifest();
  const dataPath = manifest.documents[path];
  if (dataPath) await fetchStaticFile(dataPath);
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

  const url = new URL(requestUrl, 'http://lat.local');
  if (url.pathname === '/api/search') {
    const endpoint = staticViewSearchApi();
    if (!endpoint) throw new Error('Static views do not include search');
    const target = new URL(endpoint, window.location.origin);
    target.search = url.search;
    return fetchJsonFile<T>(target.toString(), signal);
  }

  const manifest = await staticManifest();
  if (url.pathname === '/api/index') return manifest.index as T;

  const initial = staticBootstrap()?.responses[requestUrl];
  if (initial) return initial as T;

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
      fetchStaticFile<ViewStaticSourceFile>(entry.file),
      fetchStaticFile<ViewStaticSourceView>(entry.view),
    ]);
    return { ...file, ...view } as ViewSourceDocument as T;
  } else if (url.pathname === '/api/external') {
    const entry = manifest.externals[url.searchParams.get('target') ?? ''];
    if (!entry) throw new Error('Static external data not found');
    if (entry.kind === 'markdown') {
      const document = await fetchStaticFile<ViewStaticExternalMarkdown>(
        entry.document,
      );
      return document as T;
    }
    const [file, view] = await Promise.all([
      fetchStaticFile<ViewStaticSourceFile>(entry.file),
      fetchStaticFile<ViewStaticExternalSourceView>(entry.view),
    ]);
    return {
      ...view,
      source: { ...file, ...view.source },
    } as ViewExternalDocument as T;
  }
  if (!dataPath) throw new Error('Static view data not found');
  return fetchStaticFile<T>(dataPath);
}
