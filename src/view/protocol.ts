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
};

export type ViewError = {
  error: string;
};
