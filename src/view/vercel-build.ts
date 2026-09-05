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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { nodeFileTrace } from '@vercel/nft';
import { LAT_UI_CONTENT_SECURITY_POLICY } from '@lat.md/server';
import {
  MANIFEST_FILE,
  readManifest as readSearchManifest,
} from '../search/db.js';

type FileTraceResult = {
  fileList: Set<string>;
  warnings: Set<Error>;
};

export type VercelBuildDependencies = {
  traceFiles: (
    files: string[],
    options: {
      base: string;
      conditions: string[];
      exportsOnly: boolean;
      processCwd: string;
    },
  ) => Promise<FileTraceResult>;
};

export type VercelBuildOptions = {
  force?: boolean;
  warn?: (message: string) => void;
};

export type VercelBuildResult = {
  files: number;
  functionPath: string;
  outputDir: string;
};

const defaultDependencies: VercelBuildDependencies = {
  traceFiles: nodeFileTrace,
};

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function basePathSegments(basePath: string): string[] {
  const parsed = new URL(basePath, 'http://lat.local');
  if (
    parsed.origin !== 'http://lat.local' ||
    parsed.search ||
    parsed.hash ||
    !basePath.startsWith('/')
  ) {
    throw new Error(`Invalid Lat UI server base path: ${basePath}`);
  }
  return parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      const decoded = decodeURIComponent(part);
      if (
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('/') ||
        decoded.includes('\\')
      ) {
        throw new Error(`Invalid Lat UI server base path: ${basePath}`);
      }
      return decoded;
    });
}

function safeTracePath(path: string): string {
  if (
    isAbsolute(path) ||
    path === '..' ||
    path.startsWith(`..${sep}`) ||
    path.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`Node file trace escaped the server artifact: ${path}`);
  }
  return path;
}

function outputConfig(): unknown {
  const securityHeaders = {
    'Content-Security-Policy': LAT_UI_CONTENT_SECURITY_POLICY,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  const immutableHeaders = {
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  return {
    version: 3,
    routes: [
      { src: '/(.*)', headers: securityHeaders, continue: true },
      {
        src: '/(?:.*?/)?assets/.*',
        headers: immutableHeaders,
        continue: true,
      },
      {
        src: '/(?:.*?/)?data/[^/]+/[a-f0-9]{20}\\.json',
        headers: immutableHeaders,
        continue: true,
      },
      { handle: 'filesystem' },
      { src: '/', dest: '/index.html' },
      { src: '/(.*)/', dest: '/$1/index.html' },
      { src: '/(.*)', dest: '/$1/index.html' },
    ],
  };
}

/** Convert an installed portable Lat UI server into Vercel Build Output API v3. */
export async function buildVercelOutput(
  requestedArtifact: string,
  requestedOutput = '.vercel/output',
  options: VercelBuildOptions = {},
  dependencies: VercelBuildDependencies = defaultDependencies,
): Promise<VercelBuildResult> {
  const artifactDir = resolve(requestedArtifact);
  const outputDir = resolve(requestedOutput);
  if (!options.force) {
    try {
      await lstat(outputDir);
      throw new Error(
        `Vercel build output already exists: ${outputDir}. Use force to replace it.`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const manifestFile = join(artifactDir, 'server-data', 'server.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
    basePath?: unknown;
  };
  if (typeof manifest.basePath !== 'string') {
    throw new Error(`Invalid Lat UI server manifest: ${manifestFile}`);
  }

  const entrypoint = join(artifactDir, 'app.mjs');
  const trace = await dependencies.traceFiles([entrypoint], {
    base: artifactDir,
    conditions: ['node', 'production'],
    exportsOnly: true,
    processCwd: artifactDir,
  });
  for (const warning of trace.warnings) {
    options.warn?.(`Node file trace: ${warning.message}`);
  }

  // NFT cannot discover a database filename read dynamically from JSON.
  const searchManifest = readSearchManifest(join(artifactDir, 'server-data'));
  if (!searchManifest) {
    throw new Error(
      'Missing hybrid search index manifest; rebuild this deployment.',
    );
  }
  trace.fileList.add('server-data/server.json');
  trace.fileList.add(`server-data/${MANIFEST_FILE}`);
  trace.fileList.add(`server-data/${searchManifest.file}`);

  await mkdir(dirname(outputDir), { recursive: true });
  const stagingDir = await mkdtemp(
    join(dirname(outputDir), '.lat-vercel-staging-'),
  );
  try {
    const staticDir = join(stagingDir, 'static');
    const functionPath = join(
      'functions',
      ...basePathSegments(manifest.basePath),
      'api',
      'search.func',
    );
    const functionDir = join(stagingDir, functionPath);
    await cp(join(artifactDir, 'public'), staticDir, { recursive: true });

    for (const traced of trace.fileList) {
      const path = safeTracePath(traced);
      const destination = join(functionDir, path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(artifactDir, path), destination, {
        dereference: true,
        recursive: true,
      });
    }
    await writeFile(
      join(functionDir, '.vc-config.json'),
      json({
        runtime: 'nodejs22.x',
        handler: 'app.mjs',
        launcherType: 'Nodejs',
        shouldAddHelpers: true,
      }),
    );
    await writeFile(join(stagingDir, 'config.json'), json(outputConfig()));

    if (options.force) await rm(outputDir, { recursive: true, force: true });
    await rename(stagingDir, outputDir);
    return { files: trace.fileList.size, functionPath, outputDir };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
