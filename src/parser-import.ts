/** One observable decision to load or skip a lazily imported parser module. */
export type ParserImportEvent = {
  parser: 'AsciiDoc parser' | 'Markdown analyzer' | 'reStructuredText parser';
  imported: boolean;
  durationMs: number;
  detail?: string;
};

export type ParserImportObserver = (event: ParserImportEvent) => void;
