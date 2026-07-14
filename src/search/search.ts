import type { Client } from '@libsql/client';
import type { Embedder } from './embedder.js';

export type SearchResult = {
  id: string;
  file: string;
  heading: string;
  content: string;
};

export async function searchSections(
  db: Client,
  query: string,
  embedder: Embedder,
  limit = 5,
): Promise<SearchResult[]> {
  const [queryVec] = await embedder.embed([query]);
  const vecJson = JSON.stringify(queryVec);

  const rows = await db.execute({
    sql: `SELECT s.id, s.file, s.heading, s.content
          FROM vector_top_k('sections_vec_idx', vector(?), ?) AS v
          JOIN sections AS s ON s.rowid = v.id`,
    args: [vecJson, limit],
  });

  return rows.rows.map((row) => ({
    id: row.id as string,
    file: row.file as string,
    heading: row.heading as string,
    content: row.content as string,
  }));
}
