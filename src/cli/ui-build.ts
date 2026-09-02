import type { CmdContext, CmdResult } from '../context.js';
import {
  buildStaticView,
  type StaticViewBuildOptions,
} from '../view/static-build.js';

/** Export the current vault as a serverless, read-only Lat UI. */
export async function uiBuildCommand(
  ctx: CmdContext,
  output = '.lat-build/static',
  options: StaticViewBuildOptions = {},
): Promise<CmdResult> {
  try {
    const result = await buildStaticView(ctx, output, options);
    return {
      output: `Built ${result.documents} documents and ${result.sources} source views at ${result.outputDir}`,
    };
  } catch (error) {
    return { output: (error as Error).message, isError: true };
  }
}
