export type ViewIndex = {
  files: string[];
  entry: string;
};

export type ViewDocument = {
  path: string;
  title: string;
  html: string;
  frontmatter: {
    requireCodeMention: boolean;
  };
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
