import {
  readManifest as readSearchManifest,
  MANIFEST_FILE,
} from '../search/db.js';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLatServerApp, type LatServerApp } from '@lat.md/server';
import type { Express } from 'express';
import type { Section } from '../lattice-model.js';
import type { CreateSearchEngine } from '../search/embedder.js';
import {
  createPreindexedViewSearch,
  type PreindexedViewSearch,
} from './preindexed-search.js';
import type { ViewError, ViewSearchResponse } from './protocol.js';

export const SERVER_VIEW_SCHEMA_VERSION = 1;

export type ServerViewSection = Omit<Section, 'children'> & {
  documentPath: string;
};

export type ServerViewManifest = {
  version: number;
  basePath: string;
  sections: ServerViewSection[];
};

export type ServerViewAppOptions = {
  app: Express;
  manifestFile: string | URL;
  indexFile: string | URL;
  cacheDir?: string | URL;
  createSearchEngine?: CreateSearchEngine;
  search?: (query: string) => Promise<ViewSearchResponse>;
};

export type ServerViewApp = {
  app: LatServerApp;
  close: () => Promise<void>;
};

function searchRoute(basePath: string): string {
  return `${basePath === '/' ? '' : basePath.slice(0, -1)}/api/search`;
}

function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  headOnly: boolean,
): void {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(headOnly ? undefined : body);
}

function localPath(path: string | URL): string {
  return resolve(typeof path === 'string' ? path : fileURLToPath(path));
}

async function readManifest(path: string): Promise<ServerViewManifest> {
  const manifest = JSON.parse(
    await readFile(path, 'utf8'),
  ) as ServerViewManifest;
  if (
    manifest.version !== SERVER_VIEW_SCHEMA_VERSION ||
    typeof manifest.basePath !== 'string' ||
    !Array.isArray(manifest.sections)
  ) {
    throw new Error(`Unsupported Lat server build manifest: ${path}`);
  }
  return manifest;
}

type PreparedServerView = {
  manifest: ServerViewManifest;
  search: (query: string) => Promise<ViewSearchResponse>;
  close: () => Promise<void>;
};

/** Native SQLite handles may outlive close until the Windows process exits. */
async function removeRuntimeCache(path: string): Promise<void> {
  try {
    await rm(path, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 150,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform !== 'win32' ||
      (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY')
    ) {
      throw error;
    }
    // This is an owned OS-temp copy, never the deployed index or user data.
    // A lingering native lock must not fail otherwise successful shutdown.
  }
}

async function prepareServerView(
  options: ServerViewAppOptions,
  manifestFile: string,
  indexFile: string,
): Promise<PreparedServerView> {
  const manifest = await readManifest(manifestFile);
  let runtimeCacheDir = options.cacheDir ? localPath(options.cacheDir) : '';
  let ownsCache = false;
  let search = options.search;
  let ownedSearch: PreindexedViewSearch | undefined;
  if (!search) {
    if (!runtimeCacheDir) {
      runtimeCacheDir = await mkdtemp(join(tmpdir(), 'lat-ui-search-'));
      ownsCache = true;
    }
    await mkdir(runtimeCacheDir, { recursive: true });
    try {
      const indexManifest = readSearchManifest(dirname(indexFile));
      if (!indexManifest)
        throw new Error(
          'Missing hybrid search index manifest; rebuild this deployment.',
        );
      await copyFile(
        join(dirname(indexFile), indexManifest.file),
        join(runtimeCacheDir, indexManifest.file),
      );
      await copyFile(indexFile, join(runtimeCacheDir, MANIFEST_FILE));
    } catch (error) {
      if (ownsCache) {
        await removeRuntimeCache(runtimeCacheDir);
      }
      throw error;
    }

    const documentPaths = new Map<string, string>();
    const sections: Section[] = manifest.sections.map(
      ({ documentPath, ...section }) => {
        documentPaths.set(section.id.toLowerCase(), documentPath);
        return { ...section, children: [] };
      },
    );
    ownedSearch = await createPreindexedViewSearch(
      dirname(indexFile),
      runtimeCacheDir,
      sections,
      documentPaths,
      undefined,
      options.createSearchEngine,
    );
    search = ownedSearch;
  }

  return {
    manifest,
    search,
    close: async () => {
      try {
        await ownedSearch?.close();
      } finally {
        if (ownsCache) await removeRuntimeCache(runtimeCacheDir);
      }
    },
  };
}

/**
 * Create the portable Express application emitted by `lat ui build server`.
 * Static assets are also mounted for ordinary Node hosts; platforms with a CDN
 * can serve `public/` directly and forward only the search route to this app.
 */
export function createServerViewApp(
  options: ServerViewAppOptions,
): ServerViewApp {
  const manifestFile = localPath(options.manifestFile);
  const publicDir = resolve(dirname(manifestFile), '..', 'public');
  const prepared = prepareServerView(
    options,
    manifestFile,
    localPath(options.indexFile),
  );
  const app = createLatServerApp(
    {
      publicDir,
      async handle(req, res, next) {
        const { manifest, search } = await prepared;
        const method = req.method ?? 'GET';
        const headOnly = method === 'HEAD';
        if (method !== 'GET' && !headOnly) return next();
        const url = new URL(req.url ?? '/', 'http://lat.local');
        if (url.pathname !== searchRoute(manifest.basePath)) return next();
        try {
          const query = (url.searchParams.get('query') ?? '').trim();
          if (query.length > 500) {
            sendJson(
              res,
              400,
              { error: 'Search query is too long' } satisfies ViewError,
              headOnly,
            );
            return;
          }
          sendJson(res, 200, await search(query), headOnly);
        } catch (error) {
          next(error);
        }
      },
    },
    options.app,
  );

  return {
    app,
    close: async () => {
      await (await prepared).close();
    },
  };
}
