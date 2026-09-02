import type { Client } from '@libsql/client';
import type { Embedder } from './embedder.js';

export const DEFAULT_SEARCH_LIMIT = 5;
export const DEFAULT_SEARCH_THRESHOLD = 0.35;

export type SearchResult = {
  id: string;
  file: string;
  heading: string;
  content: string;
  score: number;
};

export async function searchSections(
  db: Client,
  query: string,
  embedder: Embedder,
  limit = DEFAULT_SEARCH_LIMIT,
  threshold = DEFAULT_SEARCH_THRESHOLD,
): Promise<SearchResult[]> {
  const [queryVec] = await embedder.embed([query]);
  const vecJson = JSON.stringify(queryVec);

  const rows = await db.execute({
    sql: `SELECT s.id, s.file, s.heading, s.content,
                 1.0 - vector_distance_cos(s.embedding, vector(?)) AS score
          FROM vector_top_k('sections_vec_idx', vector(?), ?) AS v
          JOIN sections AS s ON s.rowid = v.id
          ORDER BY score DESC`,
    args: [vecJson, vecJson, limit],
  });

  const results = rows.rows.map((row) => {
    const score = Number(row.score);
    return {
      id: row.id as string,
      file: row.file as string,
      heading: row.heading as string,
      content: row.content as string,
      score: Number.isFinite(score) ? score : 0,
    };
  });

  return results.filter((result) => result.score >= threshold);
}
