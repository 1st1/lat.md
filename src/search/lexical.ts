import { stemWords, STEMMER_VERSION } from '@lat.md/stemmer';
import { CREATE_PASSAGE_FTS, type SearchDb } from './db.js';

export const LEXICAL_VERSION = `${STEMMER_VERSION}:unicode-words-v1`;

/** Same analysis for indexed fields and queries; exact identifiers bypass it. */
export function lexicalTokens(text: string): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const english = tokens.filter((token) => /^[a-z]+$/.test(token));
  const stems = stemWords(english);
  let i = 0;
  return tokens.map((token) => (/^[a-z]+$/.test(token) ? stems[i++] : token));
}

/** Populate derived lexical rows, reusing original passages and vectors. */
export async function synchronizeLexical(db: SearchDb): Promise<void> {
  const version = (
    await db.execute("SELECT value FROM meta WHERE key='lexical_version'")
  ).rows[0]?.value;
  if (version !== LEXICAL_VERSION) {
    await db.execute('DROP INDEX IF EXISTS chunks_fts');
    await db.execute('DELETE FROM lexical_chunks');
  }
  await db.execute(
    'DELETE FROM lexical_chunks WHERE id NOT IN (SELECT id FROM chunks)',
  );
  const rows = (
    await db.execute(
      'SELECT id,body,heading,path FROM chunks WHERE id NOT IN (SELECT id FROM lexical_chunks)',
    )
  ).rows;
  for (const row of rows)
    await db.execute({
      sql: 'INSERT INTO lexical_chunks VALUES (?,?,?,?)',
      args: [
        row.id,
        ...[row.body, row.heading, row.path].map((text) =>
          lexicalTokens(text).join(' '),
        ),
      ],
    });
  if (version !== LEXICAL_VERSION) {
    await db.execute(CREATE_PASSAGE_FTS);
    await db.execute({
      sql: 'INSERT OR REPLACE INTO meta VALUES (?,?)',
      args: ['lexical_version', LEXICAL_VERSION],
    });
  }
}
