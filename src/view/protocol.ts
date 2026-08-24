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

export type ViewError = {
  error: string;
};
