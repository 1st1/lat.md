import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import type { ServerResponse } from 'node:http';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
export const TEST_CERT_PATH = fileURLToPath(
  new URL('./fixtures/localhost-cert.pem', import.meta.url),
);
const TEST_KEY_PATH = fileURLToPath(
  new URL('./fixtures/localhost-key.pem', import.meta.url),
);

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  return stdout.trim();
}

function sendGitBackend(response: ServerResponse, body: Buffer): void {
  const marker = body.indexOf('\r\n\r\n');
  const fallback = body.indexOf('\n\n');
  const headerEnd = marker >= 0 ? marker : fallback;
  const separatorLength = marker >= 0 ? 4 : 2;
  if (headerEnd < 0) {
    response.statusCode = 500;
    response.end('Malformed git http-backend response');
    return;
  }
  const headers = body.subarray(0, headerEnd).toString('utf8').split(/\r?\n/);
  for (const header of headers) {
    const colon = header.indexOf(':');
    if (colon < 0) continue;
    const name = header.slice(0, colon);
    const value = header.slice(colon + 1).trim();
    if (name.toLowerCase() === 'status') {
      response.statusCode = Number(value.split(' ', 1)[0]);
    } else {
      response.setHeader(name, value);
    }
  }
  response.end(body.subarray(headerEnd + separatorLength));
}

export type ExternalGitFixture = {
  root: string;
  checkout: string;
  commit1: string;
  commit2: string;
  repoUrl: string;
  fetchUrl: string;
  ca: Buffer;
  rawRequests: Map<string, number>;
  close(): Promise<void>;
};

export async function createExternalGitFixture(): Promise<ExternalGitFixture> {
  const root = mkdtempSync(join(tmpdir(), 'lat-external-git-'));
  const checkout = join(root, 'checkout');
  const repositories = join(root, 'repositories');
  const bare = join(repositories, 'repo.git');
  mkdirSync(checkout, { recursive: true });
  mkdirSync(repositories, { recursive: true });
  await git(['init', '-b', 'main'], checkout);
  await git(['config', 'user.name', 'Lat Tests'], checkout);
  await git(['config', 'user.email', 'lat@example.test'], checkout);
  mkdirSync(join(checkout, 'docs'), { recursive: true });
  writeFileSync(
    join(checkout, 'docs', 'guide.md'),
    '# Guide\n\nPinned guide.\n\n## Navigation\n\nFirst version navigation.\n',
  );
  writeFileSync(
    join(checkout, 'docs', 'guide.rst'),
    'Guide\n=====\n\nPinned guide.\n\n.. _navigation:\n\nNavigation\n----------\n\nFirst version reStructuredText navigation.\n',
  );
  writeFileSync(
    join(checkout, 'docs', 'guide.adoc'),
    '= Guide\n\nPinned guide.\n\n[#navigation]\n== Navigation\n\nFirst version AsciiDoc navigation.\n',
  );
  writeFileSync(
    join(checkout, 'docs', 'widget.ts'),
    'export function widget(): string {\n  return "first";\n}\n\nexport function gadget(): number {\n  return 1;\n}\n',
  );
  await git(['add', '.'], checkout);
  await git(['commit', '-m', 'first'], checkout);
  const commit1 = await git(['rev-parse', 'HEAD'], checkout);
  writeFileSync(
    join(checkout, 'docs', 'guide.md'),
    '# Guide\n\nPinned guide.\n\n## Navigation\n\nSecond version navigation.\n',
  );
  writeFileSync(
    join(checkout, 'docs', 'guide.rst'),
    'Guide\n=====\n\nPinned guide.\n\n.. _navigation:\n\nNavigation\n----------\n\nSecond version reStructuredText navigation.\n',
  );
  writeFileSync(
    join(checkout, 'docs', 'guide.adoc'),
    '= Guide\n\nPinned guide.\n\n[#navigation]\n== Navigation\n\nSecond version AsciiDoc navigation.\n',
  );
  writeFileSync(
    join(checkout, 'docs', 'widget.ts'),
    'export function widget(): string {\n  return "second";\n}\n\nexport function gadget(): number {\n  return 2;\n}\n',
  );
  await git(['add', '.'], checkout);
  await git(['commit', '-m', 'second'], checkout);
  const commit2 = await git(['rev-parse', 'HEAD'], checkout);
  await git(['tag', '-a', 'v2', '-m', 'annotated release'], checkout);
  await git(['clone', '--bare', checkout, bare]);

  const rawRequests = new Map<string, number>();
  const server = createServer(
    {
      cert: readFileSync(TEST_CERT_PATH),
      key: readFileSync(TEST_KEY_PATH),
    },
    (request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'https://localhost');
        if (url.pathname.startsWith('/redirect-insecure/')) {
          response.statusCode = 302;
          response.setHeader('Location', 'http://localhost/unsafe');
          response.end();
          return;
        }
        if (url.pathname.startsWith('/large/')) {
          response.statusCode = 200;
          response.setHeader('Content-Length', 5 * 1024 * 1024 + 1);
          response.end();
          return;
        }
        if (url.pathname.startsWith('/html/')) {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end('<!doctype html><title>Repository browser</title>');
          return;
        }
        if (url.pathname.startsWith('/raw/')) {
          const parts = url.pathname
            .slice('/raw/'.length)
            .split('/')
            .map(decodeURIComponent);
          const commit = parts.shift() ?? '';
          const path = parts.join('/');
          const key = `${commit}:${path}`;
          rawRequests.set(key, (rawRequests.get(key) ?? 0) + 1);
          try {
            const { stdout } = await execFileAsync(
              'git',
              ['--git-dir', bare, 'show', key],
              { encoding: 'buffer', maxBuffer: 6 * 1024 * 1024 },
            );
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/octet-stream');
            response.end(stdout);
          } catch {
            response.statusCode = 404;
            response.end('Not found');
          }
          return;
        }

        const child = spawn('git', ['http-backend'], {
          env: {
            ...process.env,
            CONTENT_LENGTH: request.headers['content-length'] ?? '',
            CONTENT_TYPE: request.headers['content-type'] ?? '',
            GIT_HTTP_EXPORT_ALL: '1',
            GIT_PROJECT_ROOT: repositories,
            PATH_INFO: url.pathname,
            QUERY_STRING: url.search.slice(1),
            REMOTE_ADDR: request.socket.remoteAddress ?? '',
            REQUEST_METHOD: request.method ?? 'GET',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
        request.pipe(child.stdin);
        child.on('error', (error) => {
          if (!response.headersSent) response.statusCode = 500;
          response.end(error.message);
        });
        child.on('close', (code) => {
          if (response.writableEnded) return;
          if (code !== 0) {
            response.statusCode = 500;
            response.end(Buffer.concat(stderr));
            return;
          }
          sendGitBackend(response, Buffer.concat(stdout));
        });
      })().catch((error: unknown) => {
        response.statusCode = 500;
        response.end((error as Error).message);
      });
    },
  );
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const repoUrl = `https://localhost:${address.port}/repo.git`;
  await git(['remote', 'add', 'origin', repoUrl], checkout);

  return {
    root,
    checkout,
    commit1,
    commit2,
    repoUrl,
    fetchUrl: `https://localhost:${address.port}/raw/{commit}/{path}`,
    ca: readFileSync(TEST_CERT_PATH),
    rawRequests,
    close: async () => {
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function createExternalProject(
  fixture: ExternalGitFixture,
  options: {
    strategy: 'fetch' | 'checkout';
    commit?: string;
    localPath?: string;
    defaultFileExtension?: string;
    body?: string;
  },
): { root: string; latDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'lat-external-project-'));
  const latDir = join(root, 'lat.md');
  mkdirSync(latDir, { recursive: true });
  const fetchUrl =
    options.strategy === 'fetch'
      ? `\n      fetch-url: ${fixture.fetchUrl}`
      : '';
  const defaultFileExtension = options.defaultFileExtension
    ? `\n      default-file-extension: ${options.defaultFileExtension}`
    : '';
  writeFileSync(
    join(latDir, 'lat.md'),
    `---\nlat:\n  external-sources:\n    upstream:\n      repo: ${fixture.repoUrl}\n      commit: ${options.commit ?? fixture.commit1}\n      prefix: docs${defaultFileExtension}\n      strategy: ${options.strategy}${fetchUrl}\n---\n# Project\n\nExternal test project.\n\n${options.body ?? 'See [[upstream:guide.md#Navigation]].'}\n`,
  );
  if (options.localPath) {
    writeFileSync(
      join(latDir, 'config.local.yaml'),
      `external-sources:\n  upstream:\n    local-path: ${options.localPath}\n`,
    );
  }
  return { root, latDir };
}
