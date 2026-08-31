import { extname } from 'node:path';

/** Source file extensions supported by Lat's parser and code-reference scan. */
export const SOURCE_FILE_EXTENSIONS = [
  '.c',
  '.go',
  '.h',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.ts',
  '.tsx',
] as const;

/** A source extension supported everywhere Lat accepts source files. */
export type SourceFileExtension = (typeof SOURCE_FILE_EXTENSIONS)[number];

const sourceFileExtensionSet: ReadonlySet<string> = new Set(
  SOURCE_FILE_EXTENSIONS,
);

export function isSourceFileExtension(
  extension: string,
): extension is SourceFileExtension {
  return sourceFileExtensionSet.has(extension);
}

export function sourceFileExtension(path: string): SourceFileExtension | null {
  const extension = extname(path);
  return isSourceFileExtension(extension) ? extension : null;
}

export function isSourceFilePath(path: string): boolean {
  return sourceFileExtension(path) !== null;
}
