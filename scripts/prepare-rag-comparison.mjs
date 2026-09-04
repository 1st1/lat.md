// @lat: [[search-audit#Pre-RAG comparison]]
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [commit, destination] = process.argv.slice(2);
assert(
  commit && destination,
  'Usage: node scripts/prepare-rag-comparison.mjs COMMIT NEW_DIRECTORY',
);
const target = resolve(destination);
assert(!existsSync(target), 'Destination must not exist');
execFileSync('git', ['clone', '--no-hardlinks', '--quiet', repo, target]);
execFileSync('git', ['checkout', '--quiet', '--detach', commit], {
  cwd: target,
});
rmSync(join(target, 'lat.md'), { recursive: true });
const audit = join(repo, 'tests/cases/hybrid/real-query-audit');
const hashes = JSON.parse(readFileSync(join(audit, 'corpus.json')));
for (const file of Object.keys(hashes)) {
  const path = join(target, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    execFileSync('git', ['show', `72fbf5c:${file}`], { cwd: repo }),
  );
}
execFileSync('git', ['apply', '--unidiff-zero', join(audit, 'corpus.patch')], {
  cwd: target,
});
for (const [file, hash] of Object.entries(hashes))
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(target, file)))
      .digest('hex'),
    hash,
    file,
  );
console.log(
  `Prepared ${target}: ${Object.keys(hashes).length} frozen files verified. Install/build this checkout's historical dependencies before indexing.`,
);
