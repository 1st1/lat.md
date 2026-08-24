import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { styleText } from 'node:util';
import { findLatticeDir } from '../lattice.js';
import type { CmdContext, Styler } from '../context.js';

export type { CmdContext };

export function makeStyler(): Styler {
  return {
    bold: (s) => styleText('bold', s),
    dim: (s) => styleText('dim', s),
    red: (s) => styleText('red', s),
    cyan: (s) => styleText('cyan', s),
    white: (s) => styleText('white', s),
    green: (s) => styleText('green', s),
    yellow: (s) => styleText('yellow', s),
    boldWhite: (s) => styleText(['bold', 'white'], s),
  };
}

export function resolveContext(opts: {
  dir?: string;
  color?: boolean;
}): CmdContext {
  const color = opts.color !== false;
  if (!color) {
    process.env.NO_COLOR = '1';
  }

  const latDir = findLatticeDir(opts.dir) ?? '';
  if (!latDir) {
    console.error(styleText('red', 'No lat.md directory found'));
    console.error(styleText('dim', 'Run `lat init` to create one.'));
    process.exit(1);
  }

  const projectRoot = dirname(latDir);
  return { latDir, projectRoot, styler: makeStyler(), mode: 'cli' };
}

export function resolveCheckContext(
  opts: { dir?: string; color?: boolean },
  target?: string,
): CmdContext {
  if (target === undefined) return resolveContext(opts);

  if (opts.color === false) {
    process.env.NO_COLOR = '1';
  }

  const projectRoot = resolve(opts.dir ?? process.cwd());
  const latDir = resolve(projectRoot, target);
  try {
    if (!statSync(latDir).isDirectory()) {
      console.error(
        styleText('red', `Check target is not a directory: ${target}`),
      );
      process.exit(1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    console.error(styleText('red', `Check directory not found: ${target}`));
    process.exit(1);
  }

  return {
    latDir,
    projectRoot,
    styler: makeStyler(),
    mode: 'cli',
    headless: true,
  };
}
