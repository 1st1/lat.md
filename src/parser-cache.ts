import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { toPosix } from './walk.js';

/** Version of persistent parser outputs and their shared on-disk contract. */
export const PARSER_CACHE_VERSION = 1;

export type ParsedCacheEntry = {
  version: number;
  contentHash: string;
  value: unknown;
};

/** Hash complete parser input bytes for cache invalidation. */
export function hashParserContent(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

/** Normalize an on-disk file into its project-relative parser identity. */
export function parserCacheIdentity(
  absolutePath: string,
  projectRoot: string,
): string {
  return toPosix(relative(projectRoot, absolutePath)).normalize('NFC');
}

function readablePath(identity: string): string {
  const normalized = identity
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return (normalized || 'parsed').slice(-120);
}

function cacheShard(identity: string): string {
  const shortName = basename(identity);
  const stem = shortName.slice(0, shortName.length - extname(shortName).length);
  const firstTwo = [...stem.toLowerCase()].slice(0, 2).join('');
  return firstTwo.replace(/[^a-z0-9]/g, '_') || '_';
}

/** Return the collision-safe, short-name-sharded cache path for an identity. */
export function parsedCachePath(latDir: string, identity: string): string {
  const normalizedIdentity = toPosix(identity).normalize('NFC');
  const digest = hashParserContent(normalizedIdentity);
  return join(
    latDir,
    '.cache',
    'parsed',
    cacheShard(normalizedIdentity),
    `${digest}_${readablePath(normalizedIdentity)}`,
  );
}

/** Read and decode a cache entry, treating every malformed state as a miss. */
export async function readParsedCache(
  path: string,
): Promise<ParsedCacheEntry | null> {
  try {
    const serialized = await readFile(path, 'utf8');
    const newline = serialized.indexOf('\n');
    if (newline < 0) return null;
    const match = /^v(\d+):([a-f0-9]{40})$/.exec(
      serialized.slice(0, newline).trim(),
    );
    if (!match) return null;
    return {
      version: Number(match[1]),
      contentHash: match[2],
      value: JSON.parse(serialized.slice(newline + 1)) as unknown,
    };
  } catch {
    return null;
  }
}

/** Atomically publish one disposable parser cache entry. */
export async function writeParsedCache(
  path: string,
  contentHash: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temp,
      `v${PARSER_CACHE_VERSION}:${contentHash}\n${JSON.stringify(value)}\n`,
    );
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}
