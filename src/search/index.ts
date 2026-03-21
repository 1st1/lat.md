import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Client } from '@libsql/client';
import { loadAllSections, flattenSections, type Section } from '../lattice.js';
import { embed } from './embeddings.js';
import type { EmbeddingProvider } from './provider.js';

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function sectionContent(
  section: Section,
  projectRoot: string,
): Promise<string> {
  const filePath = join(projectRoot, section.filePath);
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  return lines.slice(section.startLine - 1, section.endLine).join('\n');
}

export type IndexStats = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
};

export async function indexSections(
  latDir: string,
  db: Client,
  provider: EmbeddingProvider,
  key?: string,
): Promise<IndexStats> {
  const projectRoot = dirname(latDir);
  const allSections = await loadAllSections(latDir);
  const flat = flattenSections(allSections);

  // Build current state: id -> { section, content, hash }
  const current = new Map<
    string,
    { section: Section; content: string; hash: string }
  >();
  for (const s of flat) {
    const text = await sectionContent(s, projectRoot);
    current.set(s.id, { section: s, content: text, hash: hashContent(text) });
  }

  // Get existing hashes from DB
  const existing = new Map<string, string>();
  const rows = await db.execute('SELECT id, content_hash FROM sections');
  for (const row of rows.rows) {
    existing.set(row.id as string, row.content_hash as string);
  }

  // Partition into new, changed, unchanged, deleted
  const toEmbed: { id: string; content: string; section: Section }[] = [];
  let unchanged = 0;

  for (const [id, entry] of current) {
    const existingHash = existing.get(id);
    if (existingHash === entry.hash) {
      unchanged++;
    } else {
      toEmbed.push({ id, content: entry.content, section: entry.section });
    }
  }

  const toDelete = [...existing.keys()].filter((id) => !current.has(id));

  // Embed new/changed sections
  if (toEmbed.length > 0) {
    const texts = toEmbed.map((e) => e.content);
    const vectors = await embed(texts, provider, key);
    const now = Date.now();

    for (let i = 0; i < toEmbed.length; i++) {
      const { id, content, section } = toEmbed[i];
      const hash = current.get(id)!.hash;
      const vecJson = JSON.stringify(vectors[i]);

      await db.execute({
        sql: `INSERT OR REPLACE INTO sections (id, file, heading, content, content_hash, embedding, updated_at)
              VALUES (?, ?, ?, ?, ?, vector(?), ?)`,
        args: [id, section.file, section.heading, content, hash, vecJson, now],
      });
    }
  }

  // Delete removed sections
  for (const id of toDelete) {
    await db.execute({ sql: 'DELETE FROM sections WHERE id = ?', args: [id] });
  }

  const added = toEmbed.filter((e) => !existing.has(e.id)).length;
  const updated = toEmbed.filter((e) => existing.has(e.id)).length;

  return { added, updated, removed: toDelete.length, unchanged };
}
