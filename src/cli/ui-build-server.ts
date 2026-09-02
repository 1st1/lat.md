import type { CmdContext, CmdResult } from '../context.js';
import {
  buildServerView,
  type ServerViewBuildOptions,
  type ServerViewBuildResult,
} from '../view/server-build.js';

export type ServerViewBuildTarget = 'node' | 'vercel';

export type UiBuildServerOptions = ServerViewBuildOptions & {
  target?: ServerViewBuildTarget;
};

export type UiBuildServerDependencies = {
  buildNode: typeof buildServerView;
  buildVercel?: (
    ctx: CmdContext,
    output: string,
    options: ServerViewBuildOptions,
  ) => Promise<ServerViewBuildResult>;
};

const defaultDependencies: UiBuildServerDependencies = {
  buildNode: buildServerView,
};

/** Export immutable UI data with a Node or Vercel semantic-search service. */
export async function uiBuildServerCommand(
  ctx: CmdContext,
  output: string | undefined,
  options: UiBuildServerOptions = {},
  dependencies: UiBuildServerDependencies = defaultDependencies,
): Promise<CmdResult> {
  try {
    const { target = 'node', ...buildOptions } = options;
    const resolvedOutput =
      output ?? (target === 'vercel' ? '.vercel/output' : '.lat-build/server');
    let result: ServerViewBuildResult;
    if (target === 'vercel') {
      const buildVercel =
        dependencies.buildVercel ??
        (await import('../view/vercel-server-build.js')).buildVercelServerView;
      result = await buildVercel(ctx, resolvedOutput, buildOptions);
    } else {
      result = await dependencies.buildNode(ctx, resolvedOutput, buildOptions);
    }
    return {
      output: `Built ${result.documents} documents and ${result.sources} source views for ${target} at ${result.outputDir}`,
    };
  } catch (error) {
    return { output: (error as Error).message, isError: true };
  }
}
