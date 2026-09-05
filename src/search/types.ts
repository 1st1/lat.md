export type SourceSpan = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};
export type SearchEvidence = {
  chunkId: string;
  text: string;
  spans: SourceSpan[];
  channel: 'lexical' | 'semantic';
};
export type SearchDiagnostics = {
  lexicalCapped: boolean;
  semanticCapped: boolean;
  lexicalCandidates: number;
  semanticCandidates: number;
};
export type SearchResult = {
  id: string;
  file: string;
  heading: string;
  content: string;
  rankScore: number;
  semanticSimilarity?: number;
  semanticRank?: number;
  lexicalScore?: number;
  lexicalRank?: number;
  evidence: SearchEvidence[];
  diagnostics: SearchDiagnostics;
};
