import { extname } from 'node:path';
import { normalizeRepositoryPath } from '../repository-path.js';
import { isSourceFileExtension } from '../source-formats.js';

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
  const path = normalizeRepositoryPath(authoredPath);
  if (!path || !isSourceFileExtension(extname(path))) return null;

  const symbol = hash === -1 ? '' : target.slice(hash + 1);
  const fileKey = path.toLowerCase();
  return {
    path,
    symbol,
    key: `${fileKey}${symbol ? `#${symbol.toLowerCase()}` : ''}`,
    fileKey,
  };
}
