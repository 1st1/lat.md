import type {
  ViewExternalDocument,
  ViewIndex,
  ViewSourceDocument,
} from './protocol.js';

export type ViewStaticSourceRequest = {
  path: string;
  symbol: string;
  from: string;
  line: number;
  at: number;
};

export type ViewStaticSourceFile = Pick<
  ViewSourceDocument,
  'path' | 'content' | 'highlightedLines'
>;

export type ViewStaticSourceView = Omit<
  ViewSourceDocument,
  keyof ViewStaticSourceFile
>;

export type ViewStaticSourceEntry = {
  file: string;
  view: string;
};

export type ViewStaticExternalEntry =
  | { kind: 'markdown'; document: string }
  | { kind: 'source'; file: string; view: string };

export type ViewStaticExternalSourceView = {
  kind: 'source';
  target: string;
  source: ViewStaticSourceView;
};

export type ViewStaticExternalMarkdown = Extract<
  ViewExternalDocument,
  { kind: 'markdown' }
>;

export type ViewStaticManifest = {
  version: 1;
  index: ViewIndex;
  graph: string;
  documents: Record<string, string>;
  sources: Record<string, ViewStaticSourceEntry>;
  externals: Record<string, ViewStaticExternalEntry>;
};

export type ViewStaticBootstrap = {
  manifest: ViewStaticManifest;
  responses: Record<string, object>;
};

export const VIEW_STATIC_BOOTSTRAP_ID = 'lat-static-bootstrap';

/** Match the live document endpoint key used by the static browser adapter. */
export function viewStaticDocumentRequest(path: string): string {
  return `/api/document?path=${encodeURIComponent(path)}`;
}

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
