import type { CmdContext, CmdResult } from '../context.js';
import {
  buildServerView,
  type ServerViewBuildOptions,
} from '../view/server-build.js';

export type UiBuildServerOptions = ServerViewBuildOptions;

export type UiBuildServerDependencies = {
  buildNode: typeof buildServerView;
};

const defaultDependencies: UiBuildServerDependencies = {
  buildNode: buildServerView,
};

/** Export immutable UI data with a portable Node semantic-search service. */
export async function uiBuildServerCommand(
  ctx: CmdContext,
  output = '.lat-build/server',
  options: UiBuildServerOptions = {},
  dependencies: UiBuildServerDependencies = defaultDependencies,
): Promise<CmdResult> {
  try {
    const result = await dependencies.buildNode(ctx, output, options);
    return {
      output: `Built ${result.documents} documents and ${result.sources} source views for node at ${result.outputDir}`,
    };
  } catch (error) {
    return { output: (error as Error).message, isError: true };
  }
}
