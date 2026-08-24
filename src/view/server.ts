import { readFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CmdContext } from '../context.js';
import type { ViewError } from './protocol.js';
import {
  getViewDocument,
  getViewSource,
  getViewIndex,
  ViewDocumentNotFoundError,
  ViewSourceNotFoundError,
} from './repository.js';

const DEFAULT_HOST = '127.0.0.1';
const defaultClientDir = fileURLToPath(new URL('./client/', import.meta.url));

export type ViewServer = {
  server: Server;
  url: string;
  close: () => Promise<void>;
};

export type ViewServerOptions = {
  clientDir?: string;
  host?: string;
  port?: number;
};

function documentUrl(path: string): string {
  return `/docs/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  headOnly = false,
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(headOnly ? undefined : body);
}

function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  headOnly: boolean,
): void {
  res.setHeader('Cache-Control', 'no-store');
  send(
    res,
    status,
    'application/json; charset=utf-8',
    JSON.stringify(value),
    headOnly,
  );
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function clientPath(clientDir: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const candidate = resolve(clientDir, `.${decoded}`);
  const rel = relative(clientDir, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`)) return null;
  return candidate;
}

async function sendClientFile(
  res: ServerResponse,
  path: string,
  headOnly: boolean,
  immutable = false,
): Promise<void> {
  try {
    const body = await readFile(path);
    res.setHeader(
      'Cache-Control',
      immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    send(res, 200, contentType(path), body, headOnly);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    send(res, 404, 'text/plain; charset=utf-8', 'Not found', headOnly);
  }
}

/** Start the read-only loopback server used by `lat view`. */
export async function startViewServer(
  ctx: CmdContext,
  options: ViewServerOptions = {},
): Promise<ViewServer> {
  const host = options.host ?? DEFAULT_HOST;
  const clientDir = options.clientDir ?? defaultClientDir;
  const index = await getViewIndex(ctx.latDir);

  const server = createServer((req, res) => {
    void (async () => {
      setSecurityHeaders(res);
      const method = req.method ?? 'GET';
      const headOnly = method === 'HEAD';
      if (method !== 'GET' && !headOnly) {
        res.setHeader('Allow', 'GET, HEAD');
        send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
        return;
      }

      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname === '/') {
        res.statusCode = 302;
        res.setHeader('Location', documentUrl(index.entry));
        res.end();
        return;
      }

      if (url.pathname === '/api/index') {
        sendJson(res, 200, index, headOnly);
        return;
      }

      if (url.pathname === '/api/document') {
        const path = url.searchParams.get('path') ?? '';
        try {
          sendJson(res, 200, await getViewDocument(ctx.latDir, path), headOnly);
        } catch (error) {
          if (!(error instanceof ViewDocumentNotFoundError)) throw error;
          sendJson(
            res,
            404,
            { error: error.message } satisfies ViewError,
            headOnly,
          );
        }
        return;
      }

      if (url.pathname === '/api/source') {
        const path = url.searchParams.get('path') ?? '';
        const symbol = url.searchParams.get('symbol') ?? '';
        const from = url.searchParams.get('from') ?? '';
        const parsedLine = Number(url.searchParams.get('line'));
        const origin =
          from && Number.isInteger(parsedLine) && parsedLine > 0
            ? { sectionId: from, line: parsedLine }
            : undefined;
        try {
          sendJson(
            res,
            200,
            await getViewSource(
              ctx.latDir,
              ctx.projectRoot,
              path,
              symbol,
              origin,
            ),
            headOnly,
          );
        } catch (error) {
          if (!(error instanceof ViewSourceNotFoundError)) throw error;
          sendJson(
            res,
            404,
            { error: error.message } satisfies ViewError,
            headOnly,
          );
        }
        return;
      }

      if (url.pathname.startsWith('/assets/')) {
        const path = clientPath(clientDir, url.pathname);
        if (!path) {
          send(res, 404, 'text/plain; charset=utf-8', 'Not found', headOnly);
          return;
        }
        await sendClientFile(res, path, headOnly, true);
        return;
      }

      if (
        url.pathname.startsWith('/docs/') ||
        url.pathname.startsWith('/code/')
      ) {
        await sendClientFile(res, join(clientDir, 'index.html'), headOnly);
        return;
      }

      send(res, 404, 'text/plain; charset=utf-8', 'Not found', headOnly);
    })().catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy(error as Error);
        return;
      }
      sendJson(
        res,
        500,
        { error: (error as Error).message } satisfies ViewError,
        false,
      );
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
    throw new Error('Could not determine lat view server address');
  }

  return {
    server,
    url: `http://${host}:${address.port}/`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}
