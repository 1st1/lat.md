import { spawn } from 'node:child_process';
import type { CmdContext, CmdResult } from '../context.js';
import {
  startViewServer,
  type ViewServer,
  type ViewServerOptions,
} from '../view/server.js';

type ViewCommandOptions = ViewServerOptions & {
  openBrowser?: (url: string) => Promise<void>;
  onStarted?: (view: ViewServer) => void;
};

/** Launch the platform browser without passing the URL through a shell. */
export function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'explorer.exe', args: [url] }
        : { file: 'xdg-open', args: [url] };

  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** Start `lat view`, report its URL, and launch the default browser. */
export async function viewCommand(
  ctx: CmdContext,
  options: ViewCommandOptions = {},
): Promise<CmdResult> {
  const view = await startViewServer(ctx, options);
  options.onStarted?.(view);

  const lines = [`Viewing lat.md at ${view.url}`];
  try {
    await (options.openBrowser ?? openBrowser)(view.url);
  } catch (error) {
    lines.push(`Could not open the browser: ${(error as Error).message}`);
  }
  return { output: lines.join('\n') };
}
