import type { CmdContext, CmdResult } from '../context.js';
import {
  loadExternalSources,
  resolveExternalSourceHandle,
} from '../external-sources.js';

export async function getSourceCommand(
  ctx: CmdContext,
  externalSource: string,
): Promise<CmdResult> {
  const handle = externalSource.trim();
  const { sources } = loadExternalSources(ctx.projectRoot);
  const source = sources[handle];

  if (!source) {
    const handles = Object.keys(sources).sort();
    return {
      output:
        handles.length > 0
          ? `No external source "${handle}". Available handles: ${handles.join(', ')}`
          : 'No external sources configured.',
      isError: true,
    };
  }

  const resolved = resolveExternalSourceHandle(handle, source);
  if (!resolved) {
    return {
      output: `External source "${handle}" has no usable local path or canonical repo URL.`,
      isError: true,
    };
  }

  return { output: resolved.activeTarget };
}
