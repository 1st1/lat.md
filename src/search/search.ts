import { lexicalTokens } from './lexical.js';
import type { SearchDb } from './db.js';
import type { Embedder } from './embedder.js';
import type { SearchResult, SearchEvidence } from './types.js';
export type {
  SearchResult,
  SearchEvidence,
  SearchDiagnostics,
} from './types.js';

export const DEFAULT_SEARCH_LIMIT = 5;
export const DEFAULT_MIN_SIMILARITY = 0.2;
export type Candidate = {
  id: number;
  sectionId: string;
  score: number;
  exact?: boolean;
};
export function collapse(
  candidates: Candidate[],
): Map<string, Candidate & { rank: number }> {
  const unique = new Map<string, Candidate>();
  for (const c of candidates)
    if (!unique.has(c.sectionId)) unique.set(c.sectionId, c);
  let rank = 0,
    previous: Candidate | undefined;
  return new Map(
    [...unique].map(([id, c]) => {
      if (
        !previous ||
        c.score !== previous.score ||
        !!c.exact !== !!previous.exact
      )
        rank++;
      previous = c;
      return [id, { ...c, rank }];
    }),
  );
}
export function literalFtsQuery(query: string): string {
  const stopwords = new Set(
    'a an and are as at be by do does for from how i in is it of on or our that the their this to we what when where which who why with you your use uses used have has had can could would should'.split(
      ' ',
    ),
  );
  return (query.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter((t) => !stopwords.has(t.toLowerCase()))
    .flatMap((t) => lexicalTokens(t))
    .map((t) => `"${t.replaceAll('"', '\\"')}"`)
    .join(' OR ');
}
export async function searchSections(
  db: SearchDb,
  query: string,
  embedder: Embedder,
  limit = DEFAULT_SEARCH_LIMIT,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
): Promise<SearchResult[]> {
  query = query.trim();
  if (!query) return [];
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('limit must be a positive integer');
  if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1)
    throw new Error('min-similarity must be a number from 0 to 1');
  if (embedder.countTokens(query) > embedder.maxInputTokens)
    throw new Error(
      'Search query exceeds the embedding model token limit; shorten the query.',
    );
  const [vector] = await embedder.embed([query]);
  if (
    !vector ||
    vector.length !== embedder.dimensions ||
    vector.some((n) => !Number.isFinite(n))
  )
    throw new Error('Embedding backend returned an invalid query vector');
  const vectorJson = JSON.stringify(vector),
    fts = literalFtsQuery(query);
  const target = Math.max(50, limit),
    cap = 10 * target;
  const owners = new Map<number, string>(
    (await db.execute('SELECT id,section_id FROM chunks')).rows.map((r) => [
      r.id,
      r.section_id,
    ]),
  );
  const exactRows = (
    await db.execute({
      sql: 'SELECT chunk_id FROM identifiers WHERE token=? LIMIT ?',
      args: [query.toLowerCase(), cap],
    })
  ).rows;
  const exact = exactRows.map((r) => ({
    id: r.chunk_id,
    sectionId: owners.get(r.chunk_id)!,
    score: 0,
    exact: true,
  }));
  async function retrieve(channel: 'lexical' | 'semantic') {
    let count = 2 * target,
      candidates: Candidate[] = [],
      capped = false;
    while (true) {
      const rows =
        channel === 'lexical'
          ? fts
            ? (
                await db.execute({
                  sql: 'SELECT id,fts_score(body,heading,path,?) AS score FROM lexical_chunks ORDER BY score DESC LIMIT ?',
                  args: [fts, count],
                })
              ).rows
            : []
          : (
              await db.execute({
                sql: 'SELECT c.id,1-vector_distance_cos(e.embedding,vector32(?)) AS score FROM chunks c JOIN embeddings e ON c.input_hash=e.hash ORDER BY score DESC LIMIT ?',
                args: [vectorJson, count],
              })
            ).rows;
      const hits = rows
        .filter((r) =>
          channel === 'lexical' ? r.score > 0 : r.score >= minSimilarity,
        )
        .map((r) => ({
          id: r.id,
          sectionId: owners.get(r.id)!,
          score: Number(r.score),
        }));
      if (channel === 'lexical') {
        const exactIds = new Set(exact.map((c) => c.id));
        candidates = [...exact, ...hits.filter((c) => !exactIds.has(c.id))];
      } else candidates = hits;
      candidates.sort(
        (a, b) =>
          Number(!!b.exact) - Number(!!a.exact) ||
          b.score - a.score ||
          a.sectionId.localeCompare(b.sectionId) ||
          a.id - b.id,
      );
      if (
        new Set(candidates.map((c) => c.sectionId)).size >= target ||
        rows.length < count ||
        hits.length < rows.length ||
        !rows.length
      )
        break;
      if (count >= cap) {
        capped = true;
        break;
      }
      count = Math.min(cap, count * 2);
    }
    return { list: collapse(candidates), capped, count: candidates.length };
  }
  const lexical = await retrieve('lexical'),
    semantic = await retrieve('semantic');
  const all = new Set([...lexical.list.keys(), ...semantic.list.keys()]);
  const ranked = [...all]
    .map((id) => ({ id, l: lexical.list.get(id), v: semantic.list.get(id) }))
    .map((r) => ({
      ...r,
      rankScore:
        (r.l ? 1 / (60 + r.l.rank) : 0) + (r.v ? 1 / (60 + r.v.rank) : 0),
    }))
    .sort((a, b) => b.rankScore - a.rankScore || a.id.localeCompare(b.id))
    .slice(0, limit);
  const results: SearchResult[] = [];
  for (const r of ranked) {
    const s = (
      await db.execute({
        sql: 'SELECT * FROM sections WHERE id=?',
        args: [r.id],
      })
    ).rows[0];
    if (!s) continue;
    const channels = [
      ...(r.l ? [{ candidate: r.l, channel: 'lexical' as const }] : []),
      ...(r.v ? [{ candidate: r.v, channel: 'semantic' as const }] : []),
    ].sort((a, b) => a.candidate.rank - b.candidate.rank);
    const seen = new Set<number>(),
      evidence: SearchEvidence[] = [];
    for (const { candidate, channel } of channels)
      if (!seen.has(candidate.id)) {
        seen.add(candidate.id);
        const p = (
          await db.execute({
            sql: 'SELECT source_id,body,spans FROM chunks WHERE id=?',
            args: [candidate.id],
          })
        ).rows[0];
        evidence.push({
          chunkId: p.source_id,
          text: p.body,
          spans: JSON.parse(p.spans),
          channel,
        });
      }
    results.push({
      id: s.id,
      file: s.file,
      heading: s.heading,
      content: s.content,
      rankScore: r.rankScore,
      ...(r.v ? { semanticSimilarity: r.v.score, semanticRank: r.v.rank } : {}),
      ...(r.l ? { lexicalScore: r.l.score, lexicalRank: r.l.rank } : {}),
      evidence,
      diagnostics: {
        lexicalCapped: lexical.capped,
        semanticCapped: semantic.capped,
        lexicalCandidates: lexical.count,
        semanticCandidates: semantic.count,
      },
    });
  }
  return results;
}
