import type { SourceSpan } from './types.js';
import { createHash } from 'node:crypto';
import type { Embedder } from './embedder.js';
import type {
  MarkdownBlock,
  MarkdownFileAnalysis,
} from '../markdown-analysis.js';
import type { Section } from '../lattice-model.js';

export const CHUNK_POLICY = 'owned-blocks-v1';
export type Passage = {
  id: string;
  sectionId: string;
  ordinal: number;
  type: string;
  spans: SourceSpan[];
  text: string;
  input: string;
  inputHash: string;
  heading: string;
  path: string;
};
export const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
export function embeddingFingerprint(embedder: Embedder): string {
  return `${CHUNK_POLICY}:${embedder.name}:${embedder.dimensions}:${embedder.maxInputTokens}:${embedder.tokenizerFingerprint}`;
}

/** Find a fitting Unicode-safe prefix without assuming token-count monotonicity. */
export function fittingPrefix(
  text: string,
  fits: (text: string) => boolean,
): number {
  if (fits(text)) return text.length;
  let size = text.length;
  while (size > 0) {
    size = Math.floor(size / 2);
    if (size && /[\uD800-\uDBFF]/.test(text[size - 1])) size--;
    if (size && fits(text.slice(0, size))) return size;
  }
  return 0;
}

/** Every body block is owned once; headings provide context instead of copied subtrees. */
export function chunkFile(
  file: MarkdownFileAnalysis,
  sections: readonly Section[],
  embedder: Embedder,
): Passage[] {
  const local = embedder.name.startsWith('local:');
  const target = local ? 192 : 512;
  const contextBudget = local ? 48 : 96;
  const source = file.content;
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0,
      hi = lineStarts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid;
    }
    return lo + 1;
  };
  const own = new Map<string, MarkdownBlock[]>();
  const ordered = [...sections].sort(
    (a, b) => a.startLine - b.startLine || a.depth - b.depth,
  );
  let sectionIndex = 0;
  let ancestors: Section[] = [];
  for (const block of file.blocks) {
    if (block.type === 'heading' || block.type === 'yaml') continue;
    while (
      sectionIndex < ordered.length &&
      ordered[sectionIndex].startLine <= block.startLine
    ) {
      const next = ordered[sectionIndex++];
      ancestors = ancestors.filter((s) => s.endLine >= next.startLine);
      ancestors.push(next);
    }
    ancestors = ancestors.filter((s) => s.endLine >= block.endLine);
    const owner = ancestors.at(-1);
    if (!owner)
      throw new Error(`No section owns ${file.path}:${block.startLine}`);
    const blocks = own.get(owner.id) ?? [];
    blocks.push(block);
    own.set(owner.id, blocks);
  }
  const result: Passage[] = [];
  for (const section of sections) {
    const headings = section.id.split('#').slice(1);
    const rawContext = `Section: ${section.heading}\nPage: ${file.headingTitles[0] ?? file.path}\nPath: ${headings.slice(0, -1).join(' > ')}`;
    const contextLength = fittingPrefix(
      rawContext,
      (t) => embedder.countTokens(t) <= contextBudget,
    );
    const context = rawContext.slice(0, contextLength);
    const path = headings.slice(0, -1).join(' > ');
    let ordinal = 0;
    type Piece = { start: number; end: number; type: string; extra: string };
    const inputFor = (text: string, extra: string) => {
      const extraSize = fittingPrefix(
        extra,
        (t) => embedder.countTokens(t) <= contextBudget / 2,
      );
      const fullContext = [extra.slice(0, extraSize), context]
        .filter(Boolean)
        .join('\n');
      const n = fittingPrefix(
        fullContext,
        (c) =>
          embedder.countTokens(c) <= contextBudget &&
          embedder.countTokens(`${c}\n\n${text}`) <= embedder.maxInputTokens,
      );
      return n ? `${fullContext.slice(0, n)}\n\n${text}` : text;
    };
    const fits = (text: string, extra = '') =>
      embedder.countTokens(text) <= target &&
      embedder.countTokens(inputFor(text, extra)) <= embedder.maxInputTokens;
    const split = (block: MarkdownBlock, extra = ''): Piece[] => {
      const text = source.slice(block.start, block.end);
      if (fits(text, extra))
        return [
          { start: block.start, end: block.end, type: block.type, extra },
        ];
      if (block.children.length) {
        const pieces: Piece[] = [];
        let start = block.start;
        for (let i = 0; i < block.children.length; i++) {
          const child = block.children[i];
          const end =
            i + 1 < block.children.length
              ? block.children[i + 1].start
              : block.end;
          let label = extra;
          if (block.type === 'table')
            label = `Row: ${i}\nTable headers: ${source.slice(block.children[0].start, block.children[0].end)}\n${extra}`;
          if (block.type === 'tableRow') label = `Column: ${i + 1}\n${extra}`;
          if (block.type === 'listItem')
            label += `\nList item: ${text.split('\n')[0]}`;
          pieces.push(...split({ ...child, start, end }, label));
          start = end;
        }
        return pieces;
      }
      const pieces: Piece[] = [];
      let start = block.start;
      const label =
        block.type === 'code'
          ? `${extra}\nCode: ${block.language ?? ''}`
          : extra;
      while (start < block.end) {
        const rest = source.slice(start, block.end);
        let n = fittingPrefix(rest, (t) => fits(t, label));
        if (!n)
          throw new Error(
            `Cannot fit source text at ${file.path}:${lineAt(start)}`,
          );
        if (n < rest.length) {
          const prefix = rest.slice(0, n);
          const boundary =
            block.type === 'code'
              ? prefix.lastIndexOf('\n') + 1
              : [...prefix.matchAll(/[.!?](?:\s+|$)/g)].at(-1)?.index;
          const preferred =
            typeof boundary === 'number' && boundary > n / 2
              ? boundary
              : prefix.search(/\s+\S*$/);
          if (preferred > n / 2 && fits(rest.slice(0, preferred), label))
            n = preferred;
        }
        pieces.push({ start, end: start + n, type: block.type, extra: label });
        start += n;
      }
      return pieces;
    };
    const pieces = (own.get(section.id) ?? []).flatMap((block) => split(block));
    if (!pieces.length) {
      const start = lineStarts[section.startLine - 1] ?? 0;
      const end = source.indexOf('\n', start);
      pieces.push(
        ...split({
          type: 'heading',
          start,
          end: end < 0 ? source.length : end,
          startLine: section.startLine,
          endLine: section.startLine,
          children: [],
        }),
      );
    }
    let pending: Piece | undefined;
    const emit = (piece: Piece) => {
      const text = source.slice(piece.start, piece.end);
      if (!text.trim()) return;
      const input = inputFor(text, piece.extra);
      if (embedder.countTokens(input) > embedder.maxInputTokens)
        throw new Error('Chunk exceeds embedding limit');
      const inputHash = digest(`${embeddingFingerprint(embedder)}\0${input}`);
      result.push({
        id: `${section.id}:${ordinal}`,
        sectionId: section.id,
        ordinal: ordinal++,
        type: piece.type,
        spans: [
          {
            start: piece.start,
            end: piece.end,
            startLine: lineAt(piece.start),
            endLine: lineAt(Math.max(piece.start, piece.end - 1)),
          },
        ],
        text,
        input,
        inputHash,
        heading: section.heading,
        path,
      });
    };
    for (const piece of pieces) {
      if (
        pending &&
        !pending.extra &&
        !piece.extra &&
        !source.slice(pending.end, piece.start).trim() &&
        fits(source.slice(pending.start, piece.end))
      )
        pending = {
          ...pending,
          end: piece.end,
          type: pending.type === piece.type ? piece.type : 'mixed',
        };
      else {
        if (pending) emit(pending);
        pending = piece;
      }
    }
    if (pending) emit(pending);
  }
  return result;
}
