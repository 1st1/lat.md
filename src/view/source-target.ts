import { extname, posix } from 'node:path';
import { SOURCE_EXTENSIONS } from '../source-parser.js';

export type ViewSourceTarget = {
  path: string;
  symbol: string;
  key: string;
  fileKey: string;
};

/** Normalize a supported source wiki-link target for view indexes and routes. */
export function viewSourceTarget(target: string): ViewSourceTarget | null {
  const hash = target.indexOf('#');
  const authoredPath = hash === -1 ? target : target.slice(0, hash);
  if (
    !authoredPath ||
    authoredPath.includes('\\') ||
    posix.isAbsolute(authoredPath) ||
    !SOURCE_EXTENSIONS.has(extname(authoredPath))
  ) {
    return null;
  }

  const path = posix.normalize(authoredPath).replace(/^\.\//, '');
  const symbol = hash === -1 ? '' : target.slice(hash + 1);
  const fileKey = path.toLowerCase();
  return {
    path,
    symbol,
    key: `${fileKey}${symbol ? `#${symbol.toLowerCase()}` : ''}`,
    fileKey,
  };
}
