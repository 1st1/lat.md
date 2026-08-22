import { dirname } from 'node:path';
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
