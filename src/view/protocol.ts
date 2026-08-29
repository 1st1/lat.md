export type ViewGitFileStatus = 'modified' | 'new';

export type ViewGitState = {
  files: Record<string, ViewGitFileStatus>;
};

export type ViewExternalFile = {
  handle: string;
  path: string;
  target: string;
};

export type ViewIndex = {
  files: string[];
  externalFiles: ViewExternalFile[];
  entry: string;
  errorCounts: Record<string, number>;
  git: ViewGitState | null;
  logoText: string;
};

export const DEFAULT_VIEW_LOGO_TEXT = 'lat.md';

export type ViewDocumentError = {
  anchor: string;
  line: number;
  marker: 'heading' | 'line' | 'target';
  message: string;
  target: string;
};

export type ViewSearchResult = {
  sectionId: string;
  title: string;
  path: string;
  breadcrumbs: string[];
  description: string;
  url: string;
  score: number;
};

export type ViewSearchResponse = {
  query: string;
  results: ViewSearchResult[];
};

export type ViewSectionCommandOutput = {
  output: string;
  html: string;
  isError: boolean;
};

export type ViewProjectChange = {
  generation: number;
  markdownGeneration: number;
};

export type ViewGraphNodeKind = 'document' | 'source' | 'code-reference';

export type ViewGraphNode = {
  id: string;
  kind: ViewGraphNodeKind;
  label: string;
  url: string;
  breadcrumbs: string[];
  inDegree: number;
  outDegree: number;
  documentPath?: string;
  sectionId?: string;
  sourcePath?: string;
  symbol?: string;
  line?: number;
  snippet?: string;
  externalTarget?: string;
  gitStatus?: ViewGitFileStatus;
  errorCount?: number;
};

export type ViewGraphEdgeKind = 'wiki' | 'markdown' | 'source' | 'code-mention';

export type ViewGraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: ViewGraphEdgeKind;
  weight: number;
};

export type ViewGraph = {
  generation: number;
  nodes: ViewGraphNode[];
  edges: ViewGraphEdge[];
};

export type ViewDocumentTocItem = {
  id: string;
  title: string;
  depth: number;
  errorCount: number;
  hasGitChanges: boolean;
};

export type ViewDocument = {
  path: string;
  title: string;
  html: string;
  gitHtml: string | null;
  graphNodeIds: Record<string, string>;
  tableOfContents: ViewDocumentTocItem[];
  errors: ViewDocumentError[];
  backReferences: ViewSectionBackReferences[];
  frontmatter: {
    requireCodeMention: boolean;
  };
};

export type ViewMarkdownBackReference = {
  kind: 'markdown';
  sectionId: string;
  breadcrumbs: string[];
  paragraph: string;
  paragraphHtml: string;
  url: string;
};

export type ViewCodeBackReference = {
  kind: 'code';
  path: string;
  line: number;
  snippet: string;
  url: string;
};

export type ViewSectionBackReference =
  | ViewMarkdownBackReference
  | ViewCodeBackReference;

export type ViewSectionBackReferences = {
  sectionId: string;
  headingId: string;
  references: ViewSectionBackReference[];
};

export type ViewSourceReference = {
  sectionId: string;
  breadcrumbs: string[];
  paragraph: string;
  paragraphHtml: string;
  url: string;
};

export type ViewSourceDocument = {
  path: string;
  content: string;
  highlightedHtmlLines: string[];
  focus: {
    symbol: string;
    kind: string;
    signature: string;
    startLine: number;
    endLine: number;
  } | null;
  context: ViewSourceReference | null;
  otherReferences: ViewSourceReference[];
};

export type ViewExternalDocument =
  | {
      kind: 'markdown';
      target: string;
      document: ViewDocument;
    }
  | {
      kind: 'source';
      target: string;
      source: ViewSourceDocument;
    };

export type ViewError = {
  error: string;
};
