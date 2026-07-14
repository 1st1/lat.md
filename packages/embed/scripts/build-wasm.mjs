/**
 * Build the candle engine to WASM: cargo → wasm-bindgen (nodejs) → wasm-opt.
 * Outputs engine.js (CJS glue) + engine_bg.wasm into ./wasm-dist.
 *
 * Requires: rustup + wasm32-unknown-unknown target, wasm-bindgen-cli, wasm-opt.
 * Run in CI before publish (artifacts are not committed to git).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const crateDir = join(pkgDir, 'crate');
const outDir = join(pkgDir, 'wasm-dist');
const wasm = join(
  crateDir,
  'target/wasm32-unknown-unknown/release/lat_embed_engine.wasm',
);

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });

run(
  'cargo',
  ['build', '--target', 'wasm32-unknown-unknown', '--release'],
  crateDir,
);

mkdirSync(outDir, { recursive: true });
run('wasm-bindgen', [
  wasm,
  '--out-dir',
  outDir,
  '--target',
  'nodejs',
  '--out-name',
  'engine',
]);

const bg = join(outDir, 'engine_bg.wasm');
try {
  run('wasm-opt', ['-Oz', bg, '-o', bg]);
} catch {
  console.warn('wasm-opt not found or failed; shipping un-optimized wasm.');
}

if (!existsSync(bg)) throw new Error('WASM build produced no engine_bg.wasm');
console.log('WASM engine built →', outDir);
