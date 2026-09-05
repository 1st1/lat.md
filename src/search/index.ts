import { synchronizeLexical } from './lexical.js';
import { dirname } from 'node:path';
import { CREATE_PASSAGE_FTS, type SearchDb } from './db.js';
import {
  analyzeMarkdownProject,
  type MarkdownProjectAnalysis,
} from '../project-analysis.js';
import type { Embedder } from './embedder.js';
import { chunkFile, digest, embeddingFingerprint } from './chunks.js';

export function projectFingerprint(project: MarkdownProjectAnalysis): string {
  return digest(
    [...project.files.values()]
      .map((f) => `${f.projectPath}\0${digest(f.content)}`)
      .sort()
      .join('\n'),
  );
}

export type IndexStats = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
};
/** Exact identifier tokens complement FTS's punctuation and long-token handling. */
export function identifierTokens(text: string): string[] {
  return [
    ...new Set(
      (text.match(/[\p{L}\p{N}_][\p{L}\p{N}_./:#@-]*/gu) ?? [])
        .map((t) => t.toLowerCase())
        .filter((t) => /[_./:#@-]/.test(t) || t.length >= 40),
    ),
  ];
}
export async function indexSections(
  latDir: string,
  db: SearchDb,
  embedder: Embedder,
  onProgress?: (done: number, total: number) => void,
  analyzedProject?: MarkdownProjectAnalysis,
): Promise<IndexStats> {
  const project =
    analyzedProject ??
    (await analyzeMarkdownProject(latDir, dirname(latDir), {
      executor: 'auto',
    }));
  const fingerprint = embeddingFingerprint(embedder);
  const oldFingerprint = (
    await db.execute("SELECT value FROM meta WHERE key='fingerprint'")
  ).rows[0]?.value;
  if (oldFingerprint && oldFingerprint !== fingerprint)
    throw new Error(
      'Search chunking or embedding model changed; run lat reindex.',
    );
  const byFile = new Map<string, typeof project.sections>();
  for (const s of project.sections) {
    const list = byFile.get(s.filePath) ?? [];
    list.push(s);
    byFile.set(s.filePath, list);
  }
  const files = new Map(
    [...project.files.values()].map((f) => [f.projectPath, f]),
  );
  const passages = [...byFile].flatMap(([path, sections]) => {
    const file = files.get(path);
    if (!file) throw new Error(`Missing analyzed file: ${path}`);
    return chunkFile(file, sections, embedder);
  });
  const existing = new Map<string, string>(
    (await db.execute('SELECT id,content_hash FROM sections')).rows.map((r) => [
      r.id,
      r.content_hash,
    ]),
  );
  const sectionHashes = new Map<string, string>();
  const owned = new Map<string, typeof passages>();
  for (const p of passages) {
    const list = owned.get(p.sectionId) ?? [];
    list.push(p);
    owned.set(p.sectionId, list);
  }
  for (const s of project.sections) {
    sectionHashes.set(
      s.id,
      digest(
        JSON.stringify([
          { ...s, children: undefined },
          (owned.get(s.id) ?? []).map((p) => [p.inputHash, p.spans]),
        ]),
      ),
    );
  }
  const changed = new Set(
    [...sectionHashes]
      .filter(([id, hash]) => existing.get(id) !== hash)
      .map(([id]) => id),
  );
  const removed = [...existing.keys()].filter((id) => !sectionHashes.has(id));
  const stats = {
    added: [...changed].filter((id) => !existing.has(id)).length,
    updated: [...changed].filter((id) => existing.has(id)).length,
    removed: removed.length,
    unchanged: project.sections.length - changed.size,
  };
  if (!changed.size && !removed.length && oldFingerprint === fingerprint) {
    // Lexical maintenance can repair old generations without embedding work.
    await db.execute('BEGIN');
    try {
      await synchronizeLexical(db);
      await db.execute('COMMIT');
    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }
    return stats;
  }
  const storedHashes = new Set(
    (await db.execute('SELECT hash FROM embeddings')).rows.map((r) => r.hash),
  );
  const missing = new Map(
    passages
      .filter((p) => !storedHashes.has(p.inputHash))
      .map((p) => [p.inputHash, p.input]),
  );
  const entries = [...missing];
  const vectors = entries.length
    ? await embedder.embed(
        entries.map(([, input]) => input),
        onProgress,
      )
    : [];
  if (
    vectors.length !== entries.length ||
    vectors.some(
      (v) =>
        v.length !== embedder.dimensions || v.some((n) => !Number.isFinite(n)),
    )
  )
    throw new Error('Embedding backend returned invalid vectors');
  const rebuildFts =
    !existing.size ||
    // Tantivy retains deleted versions in BM25 statistics until rebuilt.
    stats.updated > 0 ||
    removed.length > 0 ||
    passages.filter((p) => changed.has(p.sectionId)).length > 512;
  await db.execute('BEGIN');
  try {
    if (rebuildFts) await db.execute('DROP INDEX IF EXISTS chunks_fts');
    for (let i = 0; i < entries.length; i++)
      await db.execute({
        sql: 'INSERT INTO embeddings VALUES (?,vector32(?))',
        args: [entries[i][0], JSON.stringify(vectors[i])],
      });
    for (const id of [...changed, ...removed]) {
      await db.execute({
        sql: 'DELETE FROM lexical_chunks WHERE id IN (SELECT id FROM chunks WHERE section_id=?)',
        args: [id],
      });
      await db.execute({
        sql: 'DELETE FROM identifiers WHERE chunk_id IN (SELECT id FROM chunks WHERE section_id=?)',
        args: [id],
      });
      await db.execute({
        sql: 'DELETE FROM chunks WHERE section_id=?',
        args: [id],
      });
      await db.execute({ sql: 'DELETE FROM sections WHERE id=?', args: [id] });
    }
    const parents = new Map<string, string>();
    for (const s of project.sections)
      for (const child of s.children) parents.set(child.id, s.id);
    for (const s of project.sections)
      if (changed.has(s.id))
        await db.execute({
          sql: 'INSERT INTO sections VALUES (?,?,?,?,?,?,?,?)',
          args: [
            s.id,
            s.file,
            s.heading,
            s.firstParagraph,
            sectionHashes.get(s.id),
            parents.get(s.id) ?? null,
            s.startLine,
            s.endLine,
          ],
        });
    for (const p of passages)
      if (changed.has(p.sectionId)) {
        const row = (
          await db.execute({
            sql: 'INSERT INTO chunks(source_id,section_id,ordinal,type,spans,body,heading,path,input_hash) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id',
            args: [
              p.id,
              p.sectionId,
              p.ordinal,
              p.type,
              JSON.stringify(p.spans),
              p.text,
              p.heading,
              p.path,
              p.inputHash,
            ],
          })
        ).rows[0];
        for (const token of identifierTokens(
          `${p.sectionId}\n${project.sectionById.get(p.sectionId.toLowerCase())?.filePath ?? ''}\n${p.heading}\n${p.path}\n${p.text}`,
        ))
          await db.execute({
            sql: 'INSERT INTO identifiers VALUES (?,?)',
            args: [token, row.id],
          });
      }
    await db.execute(
      'DELETE FROM embeddings WHERE hash NOT IN (SELECT input_hash FROM chunks)',
    );
    await db.execute({
      sql: 'INSERT OR REPLACE INTO meta VALUES (?,?)',
      args: ['fingerprint', fingerprint],
    });
    await db.execute({
      sql: 'INSERT OR REPLACE INTO meta VALUES (?,?)',
      args: ['project_hash', projectFingerprint(project)],
    });
    await synchronizeLexical(db);
    if (rebuildFts) await db.execute(CREATE_PASSAGE_FTS);
    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
  return stats;
}
