import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CmdContext } from '../context.js';
import {
  buildServerView,
  type ServerViewBuildOptions,
  type ServerViewBuildResult,
} from './server-build.js';
import { validateViewBuildOutput } from './static-build.js';
import {
  buildVercelOutput,
  type VercelBuildOptions,
  type VercelBuildResult,
} from './vercel-build.js';

export type VercelServerBuildDependencies = {
  buildNode: typeof buildServerView;
  buildOutput: (
    artifact: string,
    output: string,
    options: VercelBuildOptions,
  ) => Promise<VercelBuildResult>;
  installDependencies: (artifact: string) => Promise<void>;
};

function installServerDependencies(artifact: string): Promise<void> {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'install',
    '--ignore-scripts',
    '--no-package-lock',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
  ];
  return new Promise((resolveInstall, reject) => {
    const child = spawn(executable, args, { cwd: artifact, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveInstall();
        return;
      }
      reject(
        new Error(
          `npm install failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

const defaultDependencies: VercelServerBuildDependencies = {
  buildNode: buildServerView,
  buildOutput: buildVercelOutput,
  installDependencies: installServerDependencies,
};

/** Build the portable server in staging, install it, then emit Vercel v3 output. */
export async function buildVercelServerView(
  ctx: CmdContext,
  requestedOutput: string,
  options: ServerViewBuildOptions = {},
  dependencies: VercelServerBuildDependencies = defaultDependencies,
): Promise<ServerViewBuildResult> {
  const outputDir = resolve(ctx.projectRoot, requestedOutput);
  await validateViewBuildOutput(
    outputDir,
    ctx.projectRoot,
    'Vercel',
    options.force,
  );
  await mkdir(dirname(outputDir), { recursive: true });
  const stagingDir = await mkdtemp(
    join(dirname(outputDir), '.lat-vercel-server-'),
  );
  const nodeArtifact = join(stagingDir, 'node');

  try {
    const result = await dependencies.buildNode(ctx, nodeArtifact, {
      ...options,
      force: false,
    });
    await dependencies.installDependencies(nodeArtifact);
    await dependencies.buildOutput(nodeArtifact, outputDir, {
      force: options.force,
      warn: (message) => console.warn(message),
    });
    return { ...result, outputDir };
  } finally {
    await rm(stagingDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 150,
    });
  }
}
