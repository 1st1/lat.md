import type { ViewIndex, ViewSourceDocument } from './protocol.js';

export type ViewStaticSourceRequest = {
  path: string;
  symbol: string;
  from: string;
  line: number;
  at: number;
};

export type ViewStaticSourceFile = Pick<
  ViewSourceDocument,
  'path' | 'content' | 'highlightedHtmlLines'
>;

export type ViewStaticSourceView = Omit<
  ViewSourceDocument,
  keyof ViewStaticSourceFile
>;

export type ViewStaticSourceEntry = {
  file: string;
  view: string;
};

export type ViewStaticManifest = {
  version: 1;
  index: ViewIndex;
  graph: string;
  documents: Record<string, string>;
  sources: Record<string, ViewStaticSourceEntry>;
};

/** Stable lookup key shared by the static exporter and browser adapter. */
export function viewStaticSourceKey(request: ViewStaticSourceRequest): string {
  return JSON.stringify([
    request.path,
    request.symbol,
    request.from,
    request.line,
    request.at,
  ]);
}
