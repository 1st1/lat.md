export type Styler = {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  cyan: (s: string) => string;
  white: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  boldWhite: (s: string) => string;
};

const identity = (s: string) => s;

export const plainStyler: Styler = {
  bold: identity,
  dim: identity,
  red: identity,
  cyan: identity,
  white: identity,
  green: identity,
  yellow: identity,
  boldWhite: identity,
};

export type CmdContext = {
  latDir: string;
  projectRoot: string;
  styler: Styler;
  mode: 'cli' | 'mcp';
  /** The check target was supplied explicitly instead of discovered as lat.md. */
  headless?: boolean;
};

export type CmdResult = {
  output: string;
  isError?: boolean;
};
