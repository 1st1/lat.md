import { runIndex } from '../cli/search.js';
import type { MarkdownProjectAnalysis } from '../project-analysis.js';

export type ServerIndexRequest = {
  latDir: string;
  project: MarkdownProjectAnalysis;
  cacheDir: string;
};

process.once('message', async (request: ServerIndexRequest) => {
  try {
    await runIndex(request.latDir, undefined, request.project, {
      cacheDir: request.cacheDir,
    });
    // Process exit releases native libsql handles before staging is renamed.
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});
