export type ViewIndex = {
  files: string[];
  entry: string;
  errorCounts: Record<string, number>;
};

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
};

export type ViewSearchResponse = {
  query: string;
  results: ViewSearchResult[];
};

export type ViewProjectChange = {
  generation: number;
  markdownGeneration: number;
};

export type ViewDocument = {
  path: string;
  title: string;
  html: string;
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

export type ViewError = {
  error: string;
};
