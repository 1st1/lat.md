import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express, { type Express, type Response } from 'express';

export const LAT_UI_CONTENT_SECURITY_POLICY =
  "default-src 'self'; connect-src 'self' https://tiles.openfreemap.org; font-src 'self' data:; img-src 'self' data: https://github.githubassets.com; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export type LatServerAppOptions = {
  /** Handle dynamic routes before immutable files and fallback handlers. */
  handle?: LatServerRequestHandler;
  /** Serve a completed Lat UI export after dynamic routes. */
  publicDir?: string;
};

export type LatServerApp = RequestListener;

export type LatServerRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void | Promise<void>;

export type ListenLatServerOptions = {
  host: string;
  port: number;
  /** Advance through occupied ports. Explicit user ports should leave this off. */
  findAvailablePort?: boolean;
};

export type RunningLatServer = {
  server: Server;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

function setSecurityHeaders(res: Response): void {
  res.setHeader('Content-Security-Policy', LAT_UI_CONTENT_SECURITY_POLICY);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function isImmutablePublicFile(path: string): boolean {
  const parts = path.split(/[/\\]/);
  if (parts.includes('assets')) return true;
  return /[/\\]data[/\\][^/\\]+[/\\][a-f0-9]{20}\.json$/.test(path);
}

/** Create the common Express stack used by live and exported Lat UI servers. */
export function createLatServerApp(
  options: LatServerAppOptions = {},
  app: Express = express(),
): LatServerApp {
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    setSecurityHeaders(res);
    next();
  });
  if (options.handle) {
    app.use((req, res, next) => {
      try {
        void Promise.resolve(options.handle!(req, res, next)).catch(next);
      } catch (error) {
        next(error);
      }
    });
  }
  if (options.publicDir) {
    app.use(
      express.static(options.publicDir, {
        setHeaders(res, path) {
          res.setHeader(
            'Cache-Control',
            isImmutablePublicFile(path)
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
          );
        },
      }),
    );
  }
  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use((error: unknown, _req: unknown, res: Response, _next: unknown) => {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

/** Listen with the same strict-or-next-port behavior in every Lat UI host. */
export async function listenLatServer(
  app: LatServerApp,
  options: ListenLatServerOptions,
): Promise<RunningLatServer> {
  const server = createServer(app);
  let port = options.port;
  while (true) {
    try {
      await listen(server, options.host, port);
      break;
    } catch (error) {
      if (
        !options.findAvailablePort ||
        (error as NodeJS.ErrnoException).code !== 'EADDRINUSE' ||
        port === 65_535
      ) {
        throw error;
      }
      port++;
    }
  }
  const address = server.address() as AddressInfo | null;
  if (!address) {
    await closeServer(server);
    throw new Error('Could not determine Lat UI server address');
  }
  return {
    server,
    host: options.host,
    port: address.port,
    url: `http://${options.host}:${address.port}/`,
    close: () => closeServer(server),
  };
}

export type RunLatServerOptions = {
  host?: string;
  port?: number;
  close?: () => void | Promise<void>;
  log?: (message: string) => void;
};

/** Run an exported Express app until the standalone process is terminated. */
export async function runLatServer(
  app: LatServerApp,
  options: RunLatServerOptions = {},
): Promise<RunningLatServer> {
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const rawPort = options.port ?? Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  const running = await listenLatServer(app, { host, port: rawPort });
  (options.log ?? console.log)(`Lat UI listening on ${running.url}`);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void Promise.all([running.close(), options.close?.()]).catch(
      (error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return running;
}

/** Read this published package's exact version for generated artifacts. */
export function getLatServerVersion(): string {
  return (
    JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
  ).version;
}
